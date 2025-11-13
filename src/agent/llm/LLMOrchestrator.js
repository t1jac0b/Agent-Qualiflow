import { createLogger } from "../../utils/logger.js";
import { processBauBeschriebUpload, finalizeBauBeschrieb } from "../bauBeschrieb/processBauBeschrieb.js";
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

export class LLMOrchestrator {
  constructor({ tools = {}, sessionOptions = {}, openAIProvider } = {}) {
    this.tools = tools;
    this.logger = createLogger("agent:llm-orchestrator");
    this.sessionOptions = { maxHistory: sessionOptions.maxHistory ?? 40 };
    this.stateByChat = new Map();
    this.openAIProvider = openAIProvider ?? {
      getClient: () => getOpenAI(),
      getModel: () => getOpenAIModel(),
    };
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
    this.setContext(chatId, { pendingAttachments: state.pendingAttachmentIds.size });
  }

  applyBauBeschriebResultToContext(chatId, result = {}) {
    const patch = {};
    if (result.kunde) {
      patch.kunde = {
        ...(result.kunde ?? {}),
      };
    }
    if (result.objekt) {
      patch.objekt = {
        ...(result.objekt ?? {}),
      };
      if (result.objekt?.kundeId && !patch.kunde) {
        patch.kunde = { id: result.objekt.kundeId };
      }
    }
    if (result.baurundgang) {
      patch.baurundgang = { ...(result.baurundgang ?? {}) };
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
                    id: { type: "number" },
                    label: { type: "string" },
                    inputValue: { type: "string" },
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
        const result = await processBauBeschriebUpload({
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
        const result = await finalizeBauBeschrieb({
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
      find_kunde_by_name: async ({ name }) => db.actions.findKundeByName(name),
      find_objekt_by_name: async ({ name, kundeId }) => db.actions.findObjektByName({ name, kundeId }),
      create_kunde: async ({ name, adresse, plz, ort }) => {
        const state = this.getState(chatId);
        const result = await db.actions.ensureKunde({ name, adresse, plz, ort });
        const kundeContext = mergeContext(state.context?.kunde ?? {}, result);
        this.setContext(chatId, mergeContext(state.context ?? {}, { kunde: kundeContext }));
        return result;
      },
      create_objekt: async (payload) => {
        const state = this.getState(chatId);
        const result = await db.actions.createObjektForKunde(payload);
        const objektContext = mergeContext(state.context?.objekt ?? {}, result);
        const patch = { objekt: objektContext };
        if (!state.context?.kunde && result?.kundeId) {
          patch.kunde = { id: result.kundeId };
        }
        this.setContext(chatId, mergeContext(state.context ?? {}, patch));
        return result;
      },
      create_baurundgang: async (payload) => db.actions.createBaurundgang(payload),
      list_rueckmeldungstypen: async () => db.actions.listRueckmeldungstypen(),
      summarize_rueckmeldungen: async ({ baurundgangId }) => db.actions.summarizeRueckmeldungen({ baurundgangId }),
      ensure_qs_report_for_baurundgang: async (payload) => db.actions.ensureQsReportForBaurundgang(payload),
      create_position_with_defaults: async (payload) => db.actions.createPositionWithDefaults(payload),
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
    return this.runLLM(chatId, "");
  }

  async handleMessage({ chatId, message }) {
    return this.runLLM(chatId, message ?? "");
  }

  async runLLM(chatId, userMessage) {
    const state = this.getState(chatId);
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
              final = result ?? {};
              break;
            }
          } catch (error) {
            const content = JSON.stringify({ error: String(error?.message || error) });
            messages.push({ role: "tool", tool_call_id: call.id, content });
          }
        }
        if (final) break;
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
    state.history = messages.slice(0, 1) // keep system out of history
      .concat(messages.slice(1)).slice(-this.sessionOptions.maxHistory);

    if (!final) {
      final = { status: "unknown", message: "Ich konnte keine Antwort erzeugen." };
    }

    return final;
  }
}
