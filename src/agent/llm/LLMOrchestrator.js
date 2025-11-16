import { createLogger } from "../../utils/logger.js";
import { processBauBeschriebUpload, finalizeBauBeschrieb } from "../bauBeschrieb/processBauBeschrieb.js";
import { ReportAgent } from "../report/ReportAgent.js";
import { getQualiFlowAgent } from "../orchestratorFactory.js";
import { getOpenAI, getOpenAIModel } from "./openaiClient.js";
import { buildSystemPrompt } from "./qualiflowPrompt.js";

const KUNDE_FIELD_ALIASES = {
  name: ["name", "titel"],
  adresse: ["adresse", "address", "strasse", "straße", "street"],
  plz: ["plz", "postleitzahl", "zip"],
  ort: ["ort", "stadt", "city"],
  notiz: ["notiz", "hinweis", "kommentar", "note"],
};

const OBJEKT_FIELD_ALIASES = {
  bezeichnung: ["name", "bezeichnung", "titel"],
  adresse: ["adresse", "address", "strasse", "straße", "street"],
  plz: ["plz", "postleitzahl", "zip"],
  ort: ["ort", "stadt", "city"],
  notiz: ["notiz", "hinweis", "kommentar", "note"],
};

function matchAlias(key, aliases) {
  const lower = key.toLowerCase();
  for (const [canonical, variants] of Object.entries(aliases)) {
    if (variants.some((variant) => variant.toLowerCase() === lower)) {
      return canonical;
    }
  }
  return null;
}

function parseAddressComponents(value) {
  if (typeof value !== "string") return {};
  const trimmed = value.trim();
  if (!trimmed) return {};
  if (!trimmed.includes(",")) {
    return { adresse: trimmed };
  }
  const segments = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  if (!segments.length) {
    return {};
  }
  const data = { adresse: segments[0] };
  const remainder = segments.slice(1).join(" ").trim();
  if (remainder) {
    const match = remainder.match(/(\d{4,5})\s+(.+)/);
    if (match) {
      data.plz = match[1];
      data.ort = match[2];
    } else if (/^\d{4,5}$/.test(remainder)) {
      data.plz = remainder;
    } else {
      data.ort = remainder;
    }
  }
  return data;
}

function sanitizeEntityUpdate(input, aliases) {
  if (!input) return {};

  if (typeof input === "string") {
    return parseAddressComponents(input) ?? {};
  }

  if (typeof input !== "object") return {};

  const data = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null || value === "") continue;
    const canonical = aliases[key] ? key : matchAlias(key, aliases);
    if (!canonical) continue;

    if (canonical === "adresse") {
      Object.assign(data, parseAddressComponents(String(value)));
    } else if (canonical === "plz" || canonical === "ort" || canonical === "notiz" || canonical === "name" || canonical === "bezeichnung") {
      data[canonical] = String(value).trim();
    }
  }
  return data;
}

function mergeContext(current = {}, patch = {}) {
  return { ...current, ...patch };
}

function cloneDeep(value) {
  if (value == null) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function safeParse(json) {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

function mergeOverrides(base = {}, update = {}) {
  const merged = cloneDeep(base ?? {});
  for (const [key, value] of Object.entries(update ?? {})) {
    if (value === undefined) continue;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = mergeOverrides(merged[key] ?? {}, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function messageHasToolInvocation(message) {
  if (!message) return false;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return true;
  }
  return Boolean(message.function_call);
}

function sanitizeMessagesForToolResponses(messages = []) {
  const sanitized = [];
  let skipToolSequence = false;
  for (const entry of messages) {
    if (!entry) continue;
    // Drop assistant messages with tool_calls from history to avoid dangling sequences
    if (entry.role === "assistant" && Array.isArray(entry.tool_calls) && entry.tool_calls.length > 0) {
      skipToolSequence = true; // also drop subsequent tool responses
      continue;
    }
    if (entry.role === "tool") {
      // Drop tool messages unless directly preceded (in sanitized) by an assistant tool_call (which we don't keep)
      // or when we are skipping a tool-call sequence.
      if (skipToolSequence) {
        continue;
      }
      const previous = sanitized[sanitized.length - 1];
      if (!messageHasToolInvocation(previous)) {
        continue;
      }
    } else {
      // Any non-tool message ends the skip state
      skipToolSequence = false;
    }
    sanitized.push(entry);
  }
  return sanitized;
}

export class LLMOrchestrator {
  constructor({ tools = {}, sessionOptions = {}, openAIProvider, bauBeschriebHandlers } = {}) {
    this.tools = tools;
    this.logger = createLogger("agent:llm-orchestrator");
    this.sessionOptions = { maxHistory: sessionOptions.maxHistory ?? 40 };
    this.stateByChat = new Map();
    this.openAIProvider = openAIProvider ?? {
      getClient: () => getOpenAI(),
      getModel: () => getOpenAIModel(),
    };
    this.bauBeschriebHandlers = {
      process: bauBeschriebHandlers?.process ?? processBauBeschriebUpload,
      finalize: bauBeschriebHandlers?.finalize ?? finalizeBauBeschrieb,
    };
  }

  getQualiAgent() {
    return getQualiFlowAgent();
  }

  async deterministicFallback(chatId, userMessage) {
    try {
      const trimmed = typeof userMessage === "string" ? userMessage.trim() : "";
      if (!trimmed) return null;
      const db = this.tools?.database;
      if (!db?.actions) return null;

      const lower = trimmed.toLowerCase();

      // Try direct Kunde-Auswahl per Name (case-insensitive, exakte Übereinstimmung)
      const kunden = await db.actions.listKunden();
      const kunde = Array.isArray(kunden)
        ? kunden.find((k) => (k?.name ?? "").toLowerCase() === lower)
        : null;
      if (kunde) {
        this.setContext(chatId, { kunde: { ...kunde } });
        const objekte = await db.actions.listObjekteByKunde(kunde.id);
        const options = Array.isArray(objekte) && objekte.length
          ? objekte.map((o) => ({
              id: String(o.id ?? o.bezeichnung ?? o.name ?? Math.random()),
              label: o.bezeichnung ?? o.name ?? `Objekt ${o.id}`,
              inputValue: o.bezeichnung ?? o.name ?? `Objekt ${o.id}`,
            }))
          : [
              {
                id: "create-objekt",
                label: "Neues Objekt anlegen",
                inputValue: "Neues Objekt anlegen",
              },
            ];

        const hasObjekte = Array.isArray(objekte) && objekte.length > 0;
        return {
          status: "SUCCESS",
          message: hasObjekte
            ? "Bitte wähle ein Objekt aus der Liste aus:"
            : `Es gibt derzeit keine Objekte für den Kunden "${kunde.name}". Möchtest du ein neues Objekt anlegen?`,
          options,
          context: {
            selection: { kunde },
            options,
          },
        };
      }

      return null;
    } catch (error) {
      this.logger.warn("deterministicFallback failed", { error: error?.message });
      return null;
    }
  }

  getState(chatId) {
    if (!chatId) return null;
    let s = this.stateByChat.get(chatId);
    if (!s) {
      s = {
        context: {},
        history: [],
        contextStack: [],
        attachments: new Map(),
        pendingAttachmentIds: new Set(),
        bauBeschriebResults: new Map(),
        bauBeschriebOverrides: new Map(),
        lastReply: null,
      };
      this.stateByChat.set(chatId, s);
    }

    if (!s.attachments) s.attachments = new Map();
    if (!s.pendingAttachmentIds) s.pendingAttachmentIds = new Set();
    if (!s.bauBeschriebResults) s.bauBeschriebResults = new Map();
    if (!s.bauBeschriebOverrides) s.bauBeschriebOverrides = new Map();
    return s;
  }

  setContext(chatId, patch = {}) {
    const s = this.getState(chatId);
    const sanitizedPatch = Object.entries(patch ?? {})
      .filter(([, value]) => value !== undefined)
      .reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});
    s.context = mergeOverrides(s.context ?? {}, sanitizedPatch);
    return s.context;
  }

  resolveOptionInput(input, options = []) {
    if (!options.length) return null;
    const trimmed = input.trim();
    const lower = trimmed.toLowerCase();
    const numeric = Number.parseInt(trimmed, 10);

    const normalize = (value) => {
      if (value == null) return null;
      const text = String(value).trim();
      return text ? text.toLowerCase() : null;
    };

    if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= options.length) {
      return options[numeric - 1];
    }

    for (const option of options) {
      const candidates = [option.inputValue, option.label, option.name, option.id]
        .map(normalize)
        .filter(Boolean);
      if (candidates.includes(lower)) {
        return option;
      }
    }

    return null;
  }

  async tryHandleDeterministic(chatId, userMessage) {
    const trimmed = typeof userMessage === "string" ? userMessage.trim() : "";
    if (!trimmed) {
      return null;
    }

    const state = this.getState(chatId);
    const qualAgent = this.getQualiAgent();
    
    // Check if message looks like a question or conversation
    const looksLikeQuestion = /(\?|^(was|wie|welche|wo|wann|warum|können|kann|sollte|würde|möchte)[\s\w])/i.test(trimmed);
    
    // Get current session to check phase
    const session = qualAgent.getConversation(chatId);
    const phase = session?.phase;
    
    // Let LLM handle questions and conversational input in capture/pruefpunkte phases
    const isInFlexiblePhase = phase?.startsWith("pruefpunkte:") || phase?.startsWith("capture:");
    if (looksLikeQuestion && isInFlexiblePhase) {
      this.logger.info("Routing question to LLM", { chatId, phase, message: trimmed.slice(0, 50) });
      return null; // Let LLM handle it
    }
    
    // Try deterministic handling for clear inputs
    try {
      const result = await qualAgent.handleMessage({ chatId, message: trimmed });

      if (result && result.status !== "unknown" && result.status !== "unknown_state") {
        state.lastReply = result;
        if (result.context?.selection) {
          this.setContext(chatId, result.context.selection);
        }

        // Wenn eine Position erfolgreich angelegt wurde und ein Pending-Attachment existiert, Foto verknüpfen
        if (result.status === "capture_success" && result.context?.position?.id) {
          try {
            const note = trimmed;
            const patchedMessage = await this.linkPendingAttachmentToPosition(chatId, result, note);
            if (patchedMessage) {
              result.message = [result.message, patchedMessage].filter(Boolean).join("\n");
            }
          } catch (e) {
            this.logger.warn("Verknüpfung des Attachments fehlgeschlagen", { chatId, error: e?.message });
          }
        }

        state.history.push({ role: "user", content: trimmed });
        state.history.push({ role: "assistant", content: result.message ?? "" });
        state.history = state.history.slice(-this.sessionOptions.maxHistory);

        return result;
      }
    } catch (error) {
      this.logger.warn("QualiFlowAgent handling failed, falling back to LLM", {
        chatId,
        error: error?.message,
      });
    }

    return null;
  }

  registerAttachment(chatId, attachment = {}) {
    if (!chatId) {
      throw new Error("registerAttachment: 'chatId' ist erforderlich.");
    }
    const state = this.getState(chatId);
    const generatedId = `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const id = String(attachment.id ?? attachment.storedPath ?? generatedId);
    const name = attachment.name ?? attachment.originalFilename ?? attachment.storedFilename ?? id.split(/[\\/]/).pop();
    const storedPath = attachment.storedPath ?? (typeof attachment.id === "string" ? attachment.id : null);

    const normalized = {
      id,
      name,
      mimeType: attachment.mimeType ?? attachment.mimetype ?? "application/octet-stream",
      size: attachment.size ?? null,
      storedPath,
      storedFilename: attachment.storedFilename ?? null,
      bucket: attachment.bucket ?? null,
      uploadedAt: attachment.uploadedAt ?? new Date().toISOString(),
      uploadedBy: attachment.uploadedBy ?? null,
      originalFilename: attachment.originalFilename ?? name,
      status: attachment.status ?? "uploaded",
      processedAt: attachment.processedAt ?? null,
    };

    state.attachments.set(id, normalized);
    state.pendingAttachmentIds.add(id);
    this.setContext(chatId, {
      pendingAttachments: state.pendingAttachmentIds.size,
      lastAttachment: { id: normalized.id, name: normalized.name, mimeType: normalized.mimeType },
    });
    return normalized;
  }

  getAttachment(chatId, attachmentId) {
    if (!attachmentId) return null;
    const state = this.getState(chatId);
    return state.attachments.get(attachmentId) ?? null;
  }

  markAttachmentPending(chatId, attachmentId, meta = {}) {
    if (!attachmentId) return;
    const state = this.getState(chatId);
    const attachment = state.attachments.get(attachmentId);
    if (!attachment) {
      this.logger.warn("Attachment nicht gefunden", { chatId, attachmentId });
      return;
    }
    state.pendingAttachmentIds.add(attachmentId);
    if (meta.uploadedBy && !attachment.uploadedBy) {
      attachment.uploadedBy = meta.uploadedBy;
    }
    if (!attachment.status || attachment.status === "processed") {
      attachment.status = "uploaded";
    }
    this.setContext(chatId, { pendingAttachments: state.pendingAttachmentIds.size });
  }

  clearAttachment(chatId, attachmentId) {
    if (!attachmentId) return;
    const state = this.getState(chatId);
    state.pendingAttachmentIds.delete(attachmentId);
    state.attachments.delete(attachmentId);
    state.bauBeschriebResults.delete(attachmentId);
    state.bauBeschriebOverrides.delete(attachmentId);
    this.setContext(chatId, { pendingAttachments: state.pendingAttachmentIds.size });
  }

  applyBauBeschriebResultToContext(chatId, result = {}) {
    const patch = {};
    const sourceKunde = result.kunde ?? result.extracted?.kunde;
    if (sourceKunde) {
      patch.kunde = {
        ...(sourceKunde ?? {}),
      };
    }
    const sourceObjekt = result.objekt ?? result.extracted?.objekt;
    if (sourceObjekt) {
      patch.objekt = {
        ...(sourceObjekt ?? {}),
      };
      if (sourceObjekt?.kundeId && !patch.kunde) {
        patch.kunde = { id: sourceObjekt.kundeId };
      }
    }
    if (result.baurundgang) {
      patch.baurundgang = { ...(result.baurundgang ?? {}) };
    }
    const sourceProjektleiter = result.projektleiter ?? result.extracted?.projektleiter;
    if (sourceProjektleiter) {
      const details = sourceProjektleiter;
      patch.projektleiter = {
        id: details.id ?? null,
        name: details.name ?? details.fullName ?? details,
        email: details.email ?? details.projektleiterEmail ?? null,
        telefon: details.telefon ?? details.phone ?? null,
      };
    } else if (result.pendingFields || result.missingMandatory) {
      patch.projektleiter = patch.projektleiter ?? null;
    }
    if (Array.isArray(result.pendingFields) || Array.isArray(result.missingMandatory)) {
      patch.pendingRequirements = {
        missingMandatory: result.missingMandatory ?? [],
        pendingFields: result.pendingFields ?? [],
      };
    } else if (result.status === "created") {
      patch.pendingRequirements = null;
    }

    if (Object.keys(patch).length) {
      this.setContext(chatId, patch);
    }
  }

  buildAttachmentSummary(state) {
    if (!state?.pendingAttachmentIds?.size) {
      return null;
    }

    const attachments = Array.from(state.pendingAttachmentIds)
      .map((id) => state.attachments.get(id))
      .filter(Boolean);

    if (!attachments.length) {
      return null;
    }

    const lines = attachments.map((attachment, index) => {
      const label = attachment.name ?? attachment.originalFilename ?? `Datei ${index + 1}`;
      const mime = attachment.mimeType ?? "unbekannt";
      const size = attachment.size ? `${Math.round(attachment.size / 1024)} KB` : "?";
      const status = attachment.status ?? "unbekannt";
      return `- ${label} (${mime}, ${size}) – id: ${attachment.id} – status: ${status}`;
    });

    return [
      "Es liegen neue Datei-Uploads vor, die noch nicht verarbeitet wurden.",
      ...lines,
      "Nutze 'list_pending_attachments', 'process_baubeschrieb_attachment' oder 'finalize_baubeschrieb_attachment', um sie weiterzuverarbeiten.",
    ].join("\n");
  }

  buildPendingRequirementsMessage(result = {}) {
    const missingMandatory = Array.isArray(result.missingMandatory) ? result.missingMandatory : [];
    const pendingFields = Array.isArray(result.pendingFields) ? result.pendingFields : [];

    if (!missingMandatory.length && !pendingFields.length) {
      return null;
    }

    const lines = ["⚠️ Es fehlen noch Pflichtangaben:"];

    const findMessageForField = (field) => pendingFields.find((item) => item?.field === field)?.message;

    for (const field of missingMandatory) {
      const message = findMessageForField(field);
      lines.push(`• ${message ?? field}`);
    }

    const additionalPrompts = pendingFields.filter((item) => item?.field && !missingMandatory.includes(item.field));
    for (const item of additionalPrompts) {
      lines.push(`• ${item.message ?? item.field}`);
    }

    lines.push("", "Bitte gib die fehlenden Informationen direkt hier im Chat an (z. B. 'Projektleiter: Name').");

    return lines.join("\n");
  }

  getToolsSpec() {
    return [
      {
        type: "function",
        function: {
          name: "get_context",
          description: "Liefert den aktuellen Kontext (Kunde, Objekt, Baurundgang) der Session.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
      {
        type: "function",
        function: {
          name: "set_context",
          description: "Setzt/merged Kontextteile wie { kunde, objekt, baurundgang }.",
          parameters: {
            type: "object",
            properties: {
              kunde: { type: "object" },
              objekt: { type: "object" },
              baurundgang: { type: "object" },
            },
            additionalProperties: true,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "push_context",
          description:
            "Speichert den aktuellen Kontext auf einem Stack (z. B. vor Flow-Wechseln). Optional mit Label.",
          parameters: {
            type: "object",
            properties: {
              label: { type: "string" },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "pop_context",
          description:
            "Entfernt den zuletzt gespeicherten Kontext. Bei restore=true wird er sofort als aktueller Kontext gesetzt.",
          parameters: {
            type: "object",
            properties: {
              restore: { type: "boolean" },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "inspect_context_stack",
          description: "Listet die gespeicherten Kontext-Snapshots (Label, Reihenfolge).",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
      {
        type: "function",
        function: {
          name: "list_pending_attachments",
          description: "Gibt alle noch nicht verarbeiteten Dateianhänge mit Metadaten zurück.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
      {
        type: "function",
        function: {
          name: "process_baubeschrieb_attachment",
          description: "Verarbeitet einen hochgeladenen Bau-Beschrieb (PDF) und extrahiert Daten.",
          parameters: {
            type: "object",
            properties: {
              attachmentId: { type: "string" },
            },
            required: ["attachmentId"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "finalize_baubeschrieb_attachment",
          description: "Finalisiert einen Bau-Beschrieb nach manuellen Ergänzungen (z. B. Projektleiter).",
          parameters: {
            type: "object",
            properties: {
              attachmentId: { type: "string" },
              overrides: { type: "object" },
            },
            required: ["attachmentId"],
            additionalProperties: true,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "list_kunden",
          description: "Liste aller Kunden (id, name).",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
      {
        type: "function",
        function: {
          name: "list_objekte",
          description: "Liste aller Objekte eines Kunden.",
          parameters: {
            type: "object",
            properties: { kundeId: { type: "number" } },
            required: ["kundeId"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "list_baurundgaenge",
          description: "Liste der Baurundgänge eines Objekts (inkl. typ.name).",
          parameters: {
            type: "object",
            properties: { objektId: { type: "number" } },
            required: ["objektId"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "auto_create_baurundgaenge_for_objekt",
          description: "Erstellt die 12 Standard-Baurundgänge in definierter Reihenfolge für ein Objekt.",
          parameters: {
            type: "object",
            properties: { objektId: { type: "number" } },
            required: ["objektId"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "find_kunde_by_name",
          description: "Finde Kunden anhand exaktem Namen (case-insensitive).",
          parameters: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "find_objekt_by_name",
          description: "Finde Objekt anhand Namen und optional kundeId.",
          parameters: {
            type: "object",
            properties: { name: { type: "string" }, kundeId: { type: "number" } },
            required: ["name"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_kunde",
          description: "Erzeuge neuen Kunden oder verwende ensureKunde für Idempotenz.",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string" },
              adresse: { type: "string" },
              plz: { type: "string" },
              ort: { type: "string" },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_objekt",
          description: "Erzeuge neues Objekt für Kunde (auto-create Baurundgänge).",
          parameters: {
            type: "object",
            properties: {
              kundeId: { type: "number" },
              bezeichnung: { type: "string" },
              adresse: { type: "string" },
              plz: { type: "string" },
              ort: { type: "string" },
              objekttypId: { type: "number" },
              projektleiterId: { type: "number" },
              kontaktId: { type: "number" },
              titelbildURL: { type: "string" },
              notiz: { type: "string" },
              erstellungsjahr: { type: "number" },
            },
            required: ["kundeId"],
            additionalProperties: true,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_baurundgang",
          description: "Erzeuge Baurundgang für ein Objekt.",
          parameters: {
            type: "object",
            properties: {
              objektId: { type: "number" },
              baurundgangTypId: { type: "number" },
              datumGeplant: { type: "string" },
              notiz: { type: "string" },
            },
            required: ["objektId", "baurundgangTypId"],
            additionalProperties: true,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "list_rueckmeldungstypen",
          description: "Liste der verfügbaren Rückmeldungstypen.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
      {
        type: "function",
        function: {
          name: "summarize_rueckmeldungen",
          description: "Zusammenfassung der Positionen/Rückmeldungen für einen Baurundgang.",
          parameters: {
            type: "object",
            properties: { baurundgangId: { type: "number" } },
            required: ["baurundgangId"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "generate_report_pdf",
          description: "Generiert das QS-Report PDF und liefert downloadUrl zurück.",
          parameters: {
            type: "object",
            properties: {
              qsReportId: { type: "number" },
              baurundgangId: { type: "number" },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "ensure_qs_report_for_baurundgang",
          description: "Stellt sicher, dass ein QS-Report existiert (liefert QSReport).",
          parameters: {
            type: "object",
            properties: { kundeId: { type: "number" }, objektId: { type: "number" }, baurundgangId: { type: "number" } },
            required: ["baurundgangId"],
            additionalProperties: true,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_position_with_defaults",
          description: "Erzeuge Position mit Defaults in einem QSReport.",
          parameters: {
            type: "object",
            properties: {
              qsreportId: { type: "number" },
              bauteilId: { type: "number" },
              bereichKapitelId: { type: "number" },
              rueckmeldungstypId: { type: "number" },
              bemerkung: { type: "string" },
              frist: { type: "string" },
            },
            required: ["qsreportId", "bemerkung"],
            additionalProperties: true,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "update_kunde_fields",
          description: "Aktualisiert Kundenfelder.",
          parameters: {
            type: "object",
            properties: { id: { type: "number" }, data: { type: "object" } },
            required: ["id", "data"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "update_objekt_fields",
          description: "Aktualisiert Objektfelder.",
          parameters: {
            type: "object",
            properties: { id: { type: "number" }, data: { type: "object" } },
            required: ["id", "data"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "reply",
          description:
            "Finalisiere die Antwort an den Benutzer. Immer dieses Tool am Ende aufrufen und KEINEN freien Text direkt senden.",
          parameters: {
            type: "object",
            properties: {
              status: { type: "string" },
              message: { type: "string" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    inputValue: { type: "string" },
                    isLink: { type: "boolean" },
                  },
                  required: ["id", "label", "inputValue"],
                  additionalProperties: true,
                },
              },
              context: { type: "object" },
            },
            required: ["status", "message"],
            additionalProperties: true,
          },
        },
      },
    ];
  }

  getExecutors(chatId) {
    const db = this.tools?.database;
    return {
      get_context: async () => this.getState(chatId).context,
      set_context: async (args) => this.setContext(chatId, args),
      push_context: async ({ label } = {}) => {
        const state = this.getState(chatId);
        state.contextStack.push({ label: label ?? null, context: cloneDeep(state.context) });
        return {
          size: state.contextStack.length,
          top: state.contextStack[state.contextStack.length - 1],
        };
      },
      pop_context: async ({ restore } = {}) => {
        const state = this.getState(chatId);
        const entry = state.contextStack.pop();
        if (!entry) {
          return { restored: false, context: null };
        }
        if (restore) {
          state.context = cloneDeep(entry.context) ?? {};
        }
        return {
          restored: Boolean(restore && entry.context),
          context: entry.context ?? null,
          label: entry.label ?? null,
          size: state.contextStack.length,
        };
      },
      inspect_context_stack: async () => {
        const state = this.getState(chatId);
        return state.contextStack.map((entry, index) => ({
          index,
          label: entry.label ?? null,
          hasContext: Boolean(entry.context && Object.keys(entry.context).length),
        }));
      },
      list_pending_attachments: async () => {
        const state = this.getState(chatId);
        const attachments = Array.from(state.pendingAttachmentIds)
          .map((id) => state.attachments.get(id))
          .filter(Boolean)
          .map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
            uploadedAt: attachment.uploadedAt,
            status: attachment.status,
          }));
        return {
          pendingCount: attachments.length,
          attachments,
        };
      },
      process_baubeschrieb_attachment: async ({ attachmentId }) => {
        const state = this.getState(chatId);
        const attachment = state.attachments.get(attachmentId);
        if (!attachment) {
          throw new Error(`Attachment ${attachmentId} wurde nicht gefunden.`);
        }
        if (!attachment.storedPath) {
          throw new Error("Attachment besitzt keinen gespeicherten Pfad.");
        }
        const result = await this.bauBeschriebHandlers.process({
          filePath: attachment.storedPath,
          originalFilename: attachment.originalFilename ?? attachment.name,
          uploadedBy: attachment.uploadedBy ?? "chat",
        });
        attachment.status = result?.status ?? "processed";
        attachment.processedAt = new Date().toISOString();
        state.bauBeschriebResults.set(attachmentId, result);
        state.pendingAttachmentIds.delete(attachmentId);
        this.applyBauBeschriebResultToContext(chatId, result);
        this.setContext(chatId, { pendingAttachments: state.pendingAttachmentIds.size });
        return {
          status: result?.status,
          context: {
            ingestion: result?.ingestion,
            extracted: result?.extracted,
            pendingFields: result?.pendingFields,
            missingMandatory: result?.missingMandatory,
            attachment,
          },
          message: this.buildAttachmentSummary(state),
        };
      },
      finalize_baubeschrieb_attachment: async ({ attachmentId, overrides }) => {
        const state = this.getState(chatId);
        const attachment = state.attachments.get(attachmentId);
        if (!attachment) {
          throw new Error(`Attachment ${attachmentId} wurde nicht gefunden.`);
        }

        const baseResult = state.bauBeschriebResults.get(attachmentId);
        if (!baseResult) {
          throw new Error(`Attachment ${attachmentId} wurde noch nicht verarbeitet.`);
        }

        const mergedOverrides = mergeOverrides(state.bauBeschriebOverrides.get(attachmentId) ?? {}, overrides ?? {});
        const result = await this.bauBeschriebHandlers.finalize({
          ingestion: baseResult.ingestion,
          extracted: baseResult.extracted,
          overrides: mergedOverrides,
        });

        state.bauBeschriebResults.set(attachmentId, result);
        state.bauBeschriebOverrides.set(attachmentId, mergedOverrides);
        if (result?.status === "created") {
          this.clearAttachment(chatId, attachmentId);
          this.applyBauBeschriebResultToContext(chatId, result);
        } else {
          attachment.status = result?.status ?? "needs_input";
          attachment.processedAt = new Date().toISOString();
          state.pendingAttachmentIds.add(attachmentId);
          this.setContext(chatId, { pendingAttachments: state.pendingAttachmentIds.size });
        }

        return {
          status: result?.status,
          context: {
            ingestion: result?.ingestion,
            extracted: result?.extracted,
            pendingFields: result?.pendingFields,
            missingMandatory: result?.missingMandatory,
            attachment,
          },
          message: result?.status === "created" ? "Bau-Beschrieb wurde finalisiert." : "Es werden noch Angaben benötigt.",
        };
      },
      list_kunden: async () => db.actions.listKunden(),
      list_objekte: async ({ kundeId }) => db.actions.listObjekteByKunde(kundeId),
      list_baurundgaenge: async ({ objektId }) => db.actions.listBaurundgaengeByObjekt(objektId),
      auto_create_baurundgaenge_for_objekt: async ({ objektId }) =>
        db.actions.autoCreateBaurundgaengeForObjekt(objektId),
      find_kunde_by_name: async ({ name }) => {
        const result = await db.actions.findKundeByName(name);
        if (result) {
          const state = this.getState(chatId);
          const kundeContext = mergeContext(state.context?.kunde ?? {}, result);
          this.setContext(chatId, mergeContext(state.context ?? {}, { kunde: kundeContext }));
        }
        return result;
      },
      find_objekt_by_name: async ({ name, kundeId }) => {
        const state = this.getState(chatId);
        const result = await db.actions.findObjektByName({ name, kundeId: kundeId ?? state.context?.kunde?.id });
        if (result) {
          const objektContext = mergeContext(state.context?.objekt ?? {}, result);
          const patch = { objekt: objektContext };
          if (!state.context?.kunde && result?.kundeId) {
            patch.kunde = { id: result.kundeId };
          }
          this.setContext(chatId, mergeContext(state.context ?? {}, patch));
        }
        return result;
      },
      create_kunde: async ({ name, adresse, plz, ort }) => {
        const state = this.getState(chatId);
        const result = await db.actions.ensureKunde({ name, adresse, plz, ort });
        const kundeContext = mergeContext(state.context?.kunde ?? {}, result);
        this.setContext(chatId, mergeContext(state.context ?? {}, { kunde: kundeContext }));
        return result;
      },
      create_objekt: async (payload) => {
        const state = this.getState(chatId);
        const withKunde = { ...payload, kundeId: payload?.kundeId ?? state.context?.kunde?.id };
        if (!withKunde.kundeId) {
          throw new Error("create_objekt: 'kundeId' fehlt und ist nicht im Kontext vorhanden.");
        }
        const result = await db.actions.createObjektForKunde(withKunde);
        const objektContext = mergeContext(state.context?.objekt ?? {}, result);
        const patch = { objekt: objektContext };
        if (!state.context?.kunde && result?.kundeId) {
          patch.kunde = { id: result.kundeId };
        }
        this.setContext(chatId, mergeContext(state.context ?? {}, patch));
        return result;
      },
      create_baurundgang: async (payload) => {
        const state = this.getState(chatId);
        const withObjekt = { ...payload, objektId: payload?.objektId ?? state.context?.objekt?.id };
        if (!withObjekt.objektId) {
          throw new Error("create_baurundgang: 'objektId' fehlt und ist nicht im Kontext vorhanden.");
        }
        const result = await db.actions.createBaurundgang(withObjekt);
        const patch = { baurundgang: mergeContext(state.context?.baurundgang ?? {}, result) };
        this.setContext(chatId, mergeContext(state.context ?? {}, patch));
        return result;
      },
      list_rueckmeldungstypen: async () => db.actions.listRueckmeldungstypen(),
      summarize_rueckmeldungen: async ({ baurundgangId }) => db.actions.summarizeRueckmeldungen({ baurundgangId }),
      ensure_qs_report_for_baurundgang: async (payload) => db.actions.ensureQsReportForBaurundgang(payload),
      create_position_with_defaults: async (payload) => db.actions.createPositionWithDefaults(payload),
      generate_report_pdf: async ({ qsReportId, baurundgangId } = {}) => {
        const agent = new ReportAgent({ tools: this.tools });
        const result = await agent.handleReportGenerate({ qsReportId, baurundgangId });
        return {
          status: result?.status ?? "unknown",
          message: result?.message ?? "",
          reportId: result?.reportId ?? null,
          downloadUrl: result?.downloadUrl ?? null,
        };
      },
      update_kunde_fields: async ({ id, data }) => {
        const state = this.getState(chatId);
        let targetId = id ?? state.context?.kunde?.id;
        if (!targetId) {
          throw new Error("update_kunde_fields: 'id' fehlt und es ist kein Kunde im Kontext gesetzt.");
        }

        const sanitized = sanitizeEntityUpdate(data, KUNDE_FIELD_ALIASES);
        if (!Object.keys(sanitized).length) {
          throw new Error("update_kunde_fields: Keine gültigen Felder übergeben.");
        }

        const result = await db.actions.updateKundeFields({ id: targetId, data: sanitized });
        const mergedKunde = mergeContext(state.context?.kunde ?? {}, result);
        this.setContext(chatId, { ...state.context, kunde: mergedKunde });
        return result;
      },
      update_objekt_fields: async ({ id, data }) => {
        const state = this.getState(chatId);
        let targetId = id ?? state.context?.objekt?.id;
        if (!targetId) {
          throw new Error("update_objekt_fields: 'id' fehlt und es ist kein Objekt im Kontext gesetzt.");
        }

        const sanitized = sanitizeEntityUpdate(data, OBJEKT_FIELD_ALIASES);
        if (!Object.keys(sanitized).length) {
          throw new Error("update_objekt_fields: Keine gültigen Felder übergeben.");
        }

        const result = await db.actions.updateObjektFields({ id: targetId, data: sanitized });
        const mergedObjekt = mergeContext(state.context?.objekt ?? {}, result);
        this.setContext(chatId, { ...state.context, objekt: mergedObjekt });
        return result;
      },
      reply: async (payload) => payload,
    };
  }

  async beginConversation(chatId) {
    const qualAgent = this.getQualiAgent();
    const database = this.tools?.database;
    
    try {
      const result = await qualAgent.promptCustomerSelection({ chatId, database });
      const state = this.getState(chatId);
      state.lastReply = result;
      
      if (result.context?.selection) {
        this.setContext(chatId, result.context.selection);
      }
      
      return result;
    } catch (error) {
      this.logger.error("beginConversation failed", { chatId, error: error?.message });
      throw error;
    }
  }

  async handleMessage({ chatId, message, attachmentId, uploadedBy }) {
    // If a file attachment is referenced, handle it first to drive the capture flow deterministically
    if (attachmentId) {
      const handled = await this.handleIncomingAttachment({ chatId, message, attachmentId, uploadedBy });
      if (handled) {
        return handled;
      }
    }
    return this.runLLM(chatId, message ?? "");
  }

  async handleIncomingAttachment({ chatId, message, attachmentId, uploadedBy }) {
    try {
      const attachment = this.getAttachment(chatId, attachmentId);
      const qualAgent = this.getQualiAgent();
      const session = qualAgent.getConversation(chatId) ?? { phase: "idle", path: {} };

      if (!attachment) {
        this.logger.warn("AttachmentId nicht gefunden", { chatId, attachmentId });
        return null;
      }

      // Merke das Attachment im LLM-Kontext für nachgelagerte Verknüpfung mit der Position
      this.setContext(chatId, {
        pendingCaptureAttachment: {
          id: attachment.id,
          storedPath: attachment.storedPath ?? attachment.id,
          name: attachment.name,
          uploadedAt: attachment.uploadedAt,
          uploadedBy: uploadedBy ?? attachment.uploadedBy ?? "chat-ui",
        },
      });

      // Wenn kein Baurundgang gewählt wurde, bitte erst Kontext herstellen
      const path = session.path ?? {};
      if (!path?.baurundgang?.id) {
        return {
          status: "missing_setup",
          message: "Bitte wähle zuerst Kunde, Objekt und Baurundgang. Danach kannst du das Foto der Position zuweisen.",
        };
      }

      // Falls wir noch nicht im Capture-Flow sind, direkt starten und Bauteil-Auswahl anzeigen
      if (!String(session.phase || "").startsWith("capture:")) {
        const initialNote = typeof message === "string" ? message.trim() : "";
        const result = await qualAgent.beginCaptureFlow({ chatId, session, initialNote });
        return result;
      }

      // Bereits im Capture-Flow: mit aktueller Nachricht normal fortfahren
      const trimmed = typeof message === "string" ? message.trim() : "";
      const result = await qualAgent.handleMessage({ chatId, message: trimmed || "" });
      return result;
    } catch (error) {
      this.logger.error("handleIncomingAttachment fehlgeschlagen", { chatId, error: error?.message });
      return null;
    }
  }

  async linkPendingAttachmentToPosition(chatId, result, note) {
    const state = this.getState(chatId);
    const pending = state?.context?.pendingCaptureAttachment;
    if (!pending || !pending.id) return null;

    const db = this.tools?.database;
    if (!db?.actions?.addFoto || !db?.actions?.linkPositionFoto) return null;

    const selection = result.context?.selection ?? {};
    const baurundgangId = selection?.baurundgang?.id;
    const positionId = result.context?.position?.id;
    if (!baurundgangId || !positionId) return null;

    try {
      const foto = await db.actions.addFoto({
        data: {
          baurundgang: { connect: { id: baurundgangId } },
          dateiURL: pending.storedPath ?? pending.id,
          hinweisMarkierung: note || undefined,
        },
      });
      await db.actions.linkPositionFoto(positionId, foto.id);

      this.clearAttachment(chatId, pending.id);
      this.setContext(chatId, { pendingCaptureAttachment: null });

      return `Foto verknüpft (Position #${positionId}).`;
    } catch (error) {
      this.logger.warn("linkPendingAttachmentToPosition: Fehler bei addFoto/linkPositionFoto", {
        chatId,
        error: error?.message,
      });
      return null;
    }
  }

  async runLLM(chatId, userMessage) {
    const state = this.getState(chatId);
    if (Array.isArray(state.history)) {
      state.history = sanitizeMessagesForToolResponses(state.history);
    }

    const deterministic = await this.tryHandleDeterministic(chatId, userMessage);
    if (deterministic) {
      return deterministic;
    }

    const client = this.openAIProvider.getClient();
    const model = this.openAIProvider.getModel();

    const messages = [
      { role: "system", content: buildSystemPrompt() },
      ...state.history,
      { role: "user", content: userMessage || "Konversation gestartet" },
    ];

    const tools = this.getToolsSpec();
    const executors = this.getExecutors(chatId);

    let final = null;
    let steps = 0;

    while (steps < 8) {
      steps += 1;
      const completion = await client.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      });

      const msg = completion.choices?.[0]?.message;
      if (!msg) break;

      if (msg.tool_calls?.length) {
        messages.push({ role: "assistant", tool_calls: msg.tool_calls, content: msg.content ?? "" });
        let replyResult = null;
        for (const call of msg.tool_calls) {
          const name = call.function?.name;
          const args = safeParse(call.function?.arguments);
          const exec = executors[name];
          if (!exec) {
            const content = JSON.stringify({ error: `Unknown tool ${name}` });
            messages.push({ role: "tool", tool_call_id: call.id, content });
            continue;
          }
          try {
            const result = await exec(args ?? {});
            const content = JSON.stringify(result ?? {});
            messages.push({ role: "tool", tool_call_id: call.id, content });
            if (name === "set_context") {
              // also reflect context locally
              this.setContext(chatId, result ?? args ?? {});
            }
            if (name === "reply") {
              replyResult = result ?? {};
              state.lastReply = replyResult;
            }
          } catch (error) {
            const content = JSON.stringify({ error: String(error?.message || error) });
            messages.push({ role: "tool", tool_call_id: call.id, content });
          }
        }
        if (replyResult) {
          final = replyResult;
          break;
        }
        // Continue next LLM step
        continue;
      }

      // No tool calls. Fallback: direct content.
      const text = msg.content?.trim();
      if (text) {
        final = { status: "message", message: text };
        break;
      }
      break;
    }

    // Save limited history
    const historyWithoutSystem = messages.slice(1);
    state.history = sanitizeMessagesForToolResponses(historyWithoutSystem).slice(
      -this.sessionOptions.maxHistory,
    );

    if (!final || final?.status === "unknown") {
      const fallback = await this.deterministicFallback(chatId, userMessage);
      if (fallback) {
        final = fallback;
        state.lastReply = fallback;
      } else if (!final) {
        final = { status: "unknown", message: "Ich konnte keine Antwort erzeugen." };
        state.lastReply = final;
      }
    }

    state.lastReply = final;
    return final;
  }
}
