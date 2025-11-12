import { createLogger } from "../utils/logger.js";

const DEFAULT_SESSION_TTL_MINUTES = 120;

function normalizeInput(input) {
  return input?.trim() ?? "";
}

function parseYesNo(input) {
  const normalized = input.trim().toLowerCase();
  const affirmative = new Set(["ja", "j", "yes", "y", "klar", "ok", "okay"]);
  const negative = new Set(["nein", "n", "no", "nope", "nicht"]);
  if (affirmative.has(normalized)) return true;
  if (negative.has(normalized)) return false;
  return null;
}

function isNumericSelection(input, optionsLength) {
  const value = Number.parseInt(input, 10);
  if (Number.isNaN(value)) return null;
  if (value < 1 || value > optionsLength) return null;
  return value - 1;
}

function findOptionByIdOrText(options, input, { labelKey = "name", valueKey = "id" }) {
  const normalized = input.toLowerCase();
  const byId = options.find((option) => String(option[valueKey]).toLowerCase() === normalized);
  if (byId) return byId;
  return options.find((option) => option[labelKey]?.toLowerCase?.() === normalized) ?? null;
}

function resolveSelection(input, options, { labelKey = "name", valueKey = "id" } = {}) {
  if (!options?.length) return null;
  const normalized = input.toLowerCase();

  const numericIndex = isNumericSelection(input, options.length);
  if (numericIndex != null) {
    return options[numericIndex];
  }

  return findOptionByIdOrText(options, normalized, { labelKey, valueKey });
}

function isCaptureTrigger(input) {
  const normalized = input.toLowerCase();
  if (
    normalized === "neue position" ||
    normalized === "position" ||
    normalized === "position erfassen" ||
    normalized.includes("neue position") ||
    normalized.includes("position erfassen") ||
    normalized === "foto"
  ) {
    return true;
  }
  return normalized.startsWith("http://") || normalized.startsWith("https://");
}

function isCancelCommand(input) {
  const normalized = input.toLowerCase();
  return normalized === "abbrechen" || normalized === "stop" || normalized === "cancel";
}

function extractInitialNote(input) {
  if (!input) return "";
  const normalized = input.toLowerCase();
  if (normalized === "neue position" || normalized === "position" || normalized === "position erfassen" || normalized === "foto") {
    return "";
  }
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return "";
  }
  return input;
}


function describeOptions(options, { labelKey = "name", valueKey = "id", formatter } = {}) {
  if (!options?.length) {
    return "Keine Einträge gefunden.";
  }

  return options
    .map((option, index) => {
      if (typeof formatter === "function") {
        return `${index + 1}) ${formatter(option)}`;
      }
      const label = option[labelKey] ?? option[valueKey];
      return `${index + 1}) ${label}`;
    })
    .join("\n");
}

function composeSelectionSummary(path) {
  if (!path) return null;
  const bits = [];
  if (path.kunde) {
    bits.push(`Kunde: ${path.kunde.name ?? path.kunde.id}`);
  }
  if (path.objekt) {
    bits.push(`Objekt: ${path.objekt.bezeichnung ?? path.objekt.id}`);
  }
  if (path.baurundgang) {
    const datum = path.baurundgang.datumDurchgefuehrt ?? path.baurundgang.datumGeplant;
    const formatted = datum ? new Date(datum).toISOString().slice(0, 10) : "kein Datum";
    bits.push(`Baurundgang: ${path.baurundgang.id} – ${formatted}`);
  }
  return bits.length ? bits.join(" • ") : null;
}

const INTENTS = {
  CAPTURE: "capture",
  EDIT: "edit",
  QUERY: "query",
  DELETE: "delete",
};

function detectIntent(input) {
  const lower = input.toLowerCase();
  if (isCaptureTrigger(lower)) {
    return INTENTS.CAPTURE;
  }
  if (/(löschen|delete|entfernen|weg damit)/i.test(lower)) {
    return INTENTS.DELETE;
  }
  if (/(bearbeiten|ändern|aktualisieren|editieren)/i.test(lower)) {
    return INTENTS.EDIT;
  }
  if (lower.includes("?") || /(welche|welcher|welches|was|zeige|liste|wie viele|status)/i.test(lower)) {
    return INTENTS.QUERY;
  }
  return null;
}

function extractEntityName(message, keyword) {
  const pattern = new RegExp(`${keyword}\\s+(.*?)\\s*(?:bearbeiten|ändern|aktualisieren|editieren|löschen|\n|$)`, "i");
  const match = message.match(pattern);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

function extractFieldUpdates(message) {
  const updates = {};
  const normalized = message.trim();
  const fieldPatterns = [
    { key: "name", variants: ["name", "bezeichnung", "titel"] },
    { key: "adresse", variants: ["adresse", "address"] },
    { key: "plz", variants: ["plz", "postleitzahl"] },
    { key: "ort", variants: ["ort", "stadt", "city"] },
    { key: "notiz", variants: ["notiz", "beschreibung", "hinweis"] },
  ];

  for (const { key, variants } of fieldPatterns) {
    for (const variant of variants) {
      const regex = new RegExp(`${variant}\\s*(?:ist|=|zu|auf|wird|:)?\\s*([^,]+)`, "i");
      const match = normalized.match(regex);
      if (match && match[1]) {
        updates[key] = match[1].trim();
        break;
      }
    }
  }

  return updates;
}

function computeFristDate(days = 14) {
  const frist = new Date();
  frist.setDate(frist.getDate() + days);
  return frist;
}

const EDIT_FIELD_LABELS = {
  kunde: {
    name: "Name",
    adresse: "Adresse",
    plz: "PLZ",
    ort: "Ort",
    notiz: "Notiz",
  },
  objekt: {
    bezeichnung: "Name",
    adresse: "Adresse",
    plz: "PLZ",
    ort: "Ort",
    notiz: "Notiz",
  },
};

const EDIT_FIELD_SYNONYMS = {
  kunde: {
    name: ["name", "titel", "bezeichnung"],
    adresse: ["adresse", "anschrift", "address", "strasse", "straße"],
    plz: ["plz", "postleitzahl"],
    ort: ["ort", "stadt", "city"],
    notiz: ["notiz", "beschreibung", "hinweis", "kommentar"],
  },
  objekt: {
    bezeichnung: ["name", "bezeichnung", "titel"],
    adresse: ["adresse", "anschrift", "address", "strasse", "straße"],
    plz: ["plz", "postleitzahl"],
    ort: ["ort", "stadt", "city"],
    notiz: ["notiz", "beschreibung", "hinweis", "kommentar"],
  },
};

function listEditFieldOptions(entityType) {
  const labels = EDIT_FIELD_LABELS[entityType];
  if (!labels) return [];
  return Object.entries(labels).map(([key, label]) => ({ id: key, name: label }));
}

function resolveEditFieldChoice(entityType, input) {
  const normalized = input.trim().toLowerCase();
  const synonyms = EDIT_FIELD_SYNONYMS[entityType];
  if (!synonyms) return null;

  for (const [field, variants] of Object.entries(synonyms)) {
    if (variants.some((variant) => normalized === variant.toLowerCase())) {
      return { field, label: EDIT_FIELD_LABELS[entityType]?.[field] ?? field };
    }
  }

  return null;
}

export class QualiFlowAgent {
  constructor({ tools = {}, logger = createLogger("agent:qualiflow"), sessionOptions = {} } = {}) {
    this.tools = tools;
    this.capabilities = new Map();
    this.subAgents = new Map();
    this.logger = logger;
    this.conversations = new Map();
    this.sessionOptions = {
      maxAgeMinutes: sessionOptions.maxAgeMinutes ?? 60,
    };
    this.setConversation = this.setConversation.bind(this);
    this.pruneConversations = this.pruneConversations.bind(this);
    this.logger.info("QualiFlow Agent initialisiert", {
      toolKeys: Object.keys(tools),
    });
  }

  resetToSetup(chatId) {
    this.setConversation(chatId, { phase: "select-customer", path: {} });
  }

  async promptCustomerSelection({ chatId, database, prefix } = {}) {
    if (!database) {
      throw new Error("promptCustomerSelection: database tool nicht verfügbar.");
    }

    const kunden = await database.actions.listKunden();
    if (!kunden?.length) {
      this.setConversation(chatId, { phase: "idle", path: {} });
      return {
        status: "no_customers",
        message: "Es wurden keine Kunden gefunden. Bitte lege zuerst Daten an.",
      };
    }

    const options = kunden.map((kunde) => ({ id: kunde.id, name: kunde.name }));
    this.setConversation(chatId, {
      phase: "select-customer",
      path: {},
      options,
    });

    const lines = [];
    if (prefix) {
      lines.push(prefix);
    }
    lines.push("Um welchen Kunden geht es?");
    lines.push(describeOptions(options, { labelKey: "name" }));

    return {
      status: "awaiting_customer",
      message: lines.join("\n"),
      context: { options, phase: "select-customer" },
    };
  }

  async ensureSetupContext(chatId, { database } = {}) {
    const session = this.getConversation(chatId);
    if (!session || !session.path?.baurundgang) {
      if (database) {
        return this.promptCustomerSelection({
          chatId,
          database,
          prefix: "Bitte führe zuerst den Setup-Flow aus.",
        });
      }

      this.resetToSetup(chatId);
      return {
        status: "missing_setup",
        message: 'Bitte führe zuerst den Setup-Flow aus. Tippe "start".',
      };
    }

    return null;
  }

  pruneConversations({ maxAgeMinutes = DEFAULT_SESSION_TTL_MINUTES } = {}) {
    const threshold = maxAgeMinutes * 60 * 1000;
    const now = Date.now();
    for (const [chatId, state] of this.conversations.entries()) {
      const updatedAt = state.updatedAt ?? 0;
      if (now - updatedAt > threshold) {
        this.conversations.delete(chatId);
      }
    }
  }

  getConversation(chatId) {
    if (!chatId) return null;
    return this.conversations.get(chatId) ?? null;
  }

  setConversation(chatId, state) {
    if (!chatId) return;
    this.conversations.set(chatId, { ...state, updatedAt: Date.now() });
  }

  clearConversation(chatId) {
    if (!chatId) return;
    this.conversations.delete(chatId);
  }

  registerSubAgent(name, agent) {
    if (!agent || typeof agent !== "object") {
      throw new Error(`registerSubAgent: agent for '${name}' must be an object instance.`);
    }

    if (this.subAgents.has(name)) {
      throw new Error(`registerSubAgent: '${name}' already registered.`);
    }

    const capabilities = agent.getCapabilities?.();
    if (!capabilities || typeof capabilities !== "object") {
      throw new Error(`registerSubAgent: agent '${name}' must expose getCapabilities().`);
    }

    for (const [capability, handler] of Object.entries(capabilities)) {
      if (this.capabilities.has(capability)) {
        throw new Error(`Capability '${capability}' already registered by '${this.capabilities.get(capability).name}'.`);
      }
      if (typeof handler !== "function") {
        throw new Error(`Capability '${capability}' for agent '${name}' must be a function.`);
      }
      this.capabilities.set(capability, { name, handler });
    }

    if (typeof agent.setTools === "function") {
      agent.setTools(this.tools);
    } else if ("tools" in agent) {
      agent.tools = this.tools;
    }

    this.subAgents.set(name, agent);
    this.logger.info("Sub-Agent registriert", {
      agent: name,
      capabilities: Object.keys(capabilities),
    });
  }

  getTool(name) {
    return this.tools[name];
  }

  getTools() {
    return { ...this.tools };
  }

  getRegisteredSubAgents() {
    return Array.from(this.subAgents.keys());
  }

  async handleTask({ type, payload }) {
    if (!type) {
      throw new Error("handleTask: 'type' is required.");
    }

    const entry = this.capabilities.get(type);
    if (!entry) {
      this.logger.error("Capability nicht gefunden", { type });
      throw new Error(`No agent registered for capability '${type}'.`);
    }

    this.logger.info("Starte Task", { type, agent: entry.name });
    const startedAt = Date.now();
    try {
      const result = entry.handler(payload ?? {});
      if (result?.then) {
        return result
          .then((resolved) => {
            this.logger.info("Task abgeschlossen", {
              type,
              agent: entry.name,
              durationMs: Date.now() - startedAt,
              status: resolved?.status ?? "unknown",
            });
            return resolved;
          })
          .catch((error) => {
            this.logger.error("Task fehlgeschlagen", {
              type,
              agent: entry.name,
              durationMs: Date.now() - startedAt,
              error,
            });
            throw error;
          });
      }

      this.logger.info("Task abgeschlossen", {
        type,
        agent: entry.name,
        durationMs: Date.now() - startedAt,
        status: result?.status ?? "unknown",
      });
      return result;
    } catch (error) {
      this.logger.error("Task fehlgeschlagen", {
        type,
        agent: entry.name,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }

  async handleMessage({ chatId, message }) {
    if (!chatId || typeof chatId !== "string") {
      throw new Error("handleMessage: 'chatId' ist erforderlich.");
    }

    const trimmed = normalizeInput(message);
    if (!trimmed) {
      return {
        status: "empty",
        message: "Bitte gib eine Nachricht ein.",
      };
    }

    this.pruneConversations();

    const database = this.tools?.database;
    if (!database) {
      throw new Error("handleMessage: database tool nicht verfügbar.");
    }

    const session = this.getConversation(chatId) ?? { phase: "idle", path: {} };
    const lower = trimmed.toLowerCase();
    const currentPath = session.path ?? {};

    if (lower === "start") {
      return this.promptCustomerSelection({ chatId, database });
    }

    if (session.phase?.startsWith("capture:")) {
      if (isCancelCommand(lower)) {
        this.setConversation(chatId, {
          ...session,
          phase: currentPath?.baurundgang ? "completed" : "idle",
          capture: null,
          options: null,
        });
        return {
          status: "capture_cancelled",
          message: "Erfassung abgebrochen.",
        };
      }
      return this.continueCaptureFlow({ chatId, session, message: trimmed });
    }

    if (session.phase?.startsWith("edit:")) {
      return this.continueEditFlow({ chatId, session, message: trimmed });
    }

    if (session.phase === "delete:confirm") {
      return this.continueDeleteFlow({ chatId, session, message: trimmed });
    }

    const intent = detectIntent(trimmed);

    if (session.phase === "idle") {
      if (intent) {
        if (intent === INTENTS.CAPTURE) {
          const ensured = await this.ensureSetupContext(chatId, { database });
          if (ensured) {
            return ensured;
          }
          return this.beginCaptureFlow({
            chatId,
            session: { ...session, path: currentPath },
            initialNote: extractInitialNote(trimmed),
          });
        }

        if (intent === INTENTS.EDIT || intent === INTENTS.DELETE || intent === INTENTS.QUERY) {
          const ensured = await this.ensureSetupContext(chatId, { database });
          if (ensured) {
            return ensured;
          }
          return this.routeIntent({ chatId, intent, message: trimmed, session });
        }
      }

      return this.promptCustomerSelection({ chatId, database });
    }

    if (session.phase === "select-customer") {
      const selected = resolveSelection(trimmed, session.options, { labelKey: "name" });
      if (!selected) {
        const list = describeOptions(session.options, { labelKey: "name" });
        return {
          status: "retry_customer",
          message: [`Ich konnte den Kunden nicht zuordnen.`, `Bitte wähle erneut:`, list].join("\n"),
        };
      }

      const objekte = await database.actions.listObjekteByKunde(selected.id);
      if (!objekte?.length) {
        this.setConversation(chatId, {
          phase: "select-customer",
          path: session.path,
          options: session.options,
        });
        return {
          status: "no_objects",
          message: `Für ${selected.name} wurden keine Objekte gefunden. Bitte wähle einen anderen Kunden (oder gib \"start\" ein, um neu zu beginnen).`,
        };
      }

      this.setConversation(chatId, {
        phase: "select-object",
        path: { ...session.path, kunde: selected },
        options: objekte,
      });

      const list = describeOptions(objekte, { labelKey: "bezeichnung" });
      return {
        status: "awaiting_object",
        message: [`Welches Objekt?`, list].join("\n"),
        context: { options: objekte, phase: "select-object" },
      };
    }

    if (session.phase === "select-object") {
      const selected = resolveSelection(trimmed, session.options, { labelKey: "bezeichnung" });
      if (!selected) {
        const list = describeOptions(session.options, { labelKey: "bezeichnung" });
        return {
          status: "retry_object",
          message: [`Objekt nicht erkannt.`, `Bitte wähle erneut:`, list].join("\n"),
        };
      }

      const baurundgaenge = await database.actions.listBaurundgaengeByObjekt(selected.id);
      if (!baurundgaenge?.length) {
        this.setConversation(chatId, {
          phase: "select-object",
          path: session.path,
          options: session.options,
        });
        return {
          status: "no_baurundgaenge",
          message: `Für das Objekt \"${selected.bezeichnung}\" wurden keine Baurundgänge gefunden. Bitte wähle ein anderes Objekt oder gib \"start\" ein, um neu zu beginnen.`,
        };
      }

      const formatter = (item) => {
        const datum = item.datumDurchgefuehrt ?? item.datumGeplant;
        const dateLabel = datum ? new Date(datum).toISOString().slice(0, 10) : "kein Datum";
        return `${item.id} – ${dateLabel}${item.notiz ? ` (${item.notiz})` : ""}`;
      };

      this.setConversation(chatId, {
        phase: "select-baurundgang",
        path: { ...session.path, objekt: selected },
        options: baurundgaenge,
      });

      const list = describeOptions(baurundgaenge, { formatter });
      return {
        status: "awaiting_baurundgang",
        message: [`Welchen Baurundgang (ID)?`, list].join("\n"),
        context: { options: baurundgaenge, phase: "select-baurundgang" },
      };
    }

    if (session.phase === "select-baurundgang") {
      const formatter = (item) => {
        const datum = item.datumDurchgefuehrt ?? item.datumGeplant;
        const dateLabel = datum ? new Date(datum).toISOString().slice(0, 10) : "kein Datum";
        return `${item.id} – ${dateLabel}`;
      };

      const selected = resolveSelection(trimmed, session.options, {
        labelKey: "id",
        valueKey: "id",
      });

      if (!selected) {
        const list = describeOptions(session.options, { formatter });
        return {
          status: "retry_baurundgang",
          message: [`Baurundgang nicht erkannt.`, `Bitte wähle erneut:`, list].join("\n"),
        };
      }

      this.setConversation(chatId, {
        phase: "pruefpunkte",
        path: { ...session.path, baurundgang: selected },
      });

      return {
        status: "awaiting_pruefpunkte",
        message: "Möchtest du Prüfpunkte erfassen? (ja/nein)",
        context: { phase: "pruefpunkte" },
      };
    }

    if (session.phase === "pruefpunkte") {
      const choice = parseYesNo(trimmed);
      if (choice == null) {
        return {
          status: "retry_pruefpunkte",
          message: "Bitte antworte mit ja oder nein (z.B. \"ja\" / \"nein\").",
        };
      }

      const path = { ...(session.path ?? {}), pruefpunkteGewuenscht: choice };
      this.setConversation(chatId, {
        phase: "completed",
        path,
      });

      const confirmation = choice
        ? "Alles klar, wir erfassen Prüfpunkte."
        : "Alles klar, wir überspringen die Prüfpunkte.";

      return {
        status: "setup_complete",
        message: `${confirmation} Setup abgeschlossen. Du kannst jetzt Positionen erfassen (Foto/Notiz).`,
        context: { selection: path },
      };
    }

    if (session.phase === "completed") {
      return {
        status: "completed",
        message: "Setup ist bereits abgeschlossen. Tippe \"start\" für einen neuen Durchlauf.",
        context: { selection: session.path },
      };
    }

    if (session.phase?.startsWith("capture:")) {
      return this.continueCaptureFlow({ chatId, session, message: trimmed });
    }

    return {
      status: "unknown_state",
      message: "Ich konnte deine Eingabe nicht verarbeiten. Tippe \"start\", um den Setup-Flow neu zu beginnen.",
    };
  }

  async routeIntent({ chatId, intent, message, session }) {
    switch (intent) {
      case INTENTS.CAPTURE:
        return this.beginCaptureFlow({ chatId, session, initialNote: extractInitialNote(message) });
      case INTENTS.DELETE:
        return this.handleDeleteIntent({ chatId, message, session });
      case INTENTS.EDIT:
        return this.handleEditIntent({ chatId, message, session });
      case INTENTS.QUERY:
        return this.handleQueryIntent({ chatId, message, session });
      default:
        return {
          status: "unhandled_intent",
          message: "Ich konnte deine Eingabe nicht zuordnen.",
        };
    }
  }

  async beginCaptureFlow({ chatId, session, initialNote = "" }) {
    const database = this.tools?.database;
    if (!database) {
      throw new Error("beginCaptureFlow: database tool nicht verfügbar.");
    }

    const { path } = session;
    if (!path?.baurundgang?.id) {
      return {
        status: "missing_setup",
        message: 'Bitte wähle zuerst einen Baurundgang über den Setup-Flow ("start").',
      };
    }

    const templates = await database.actions.listBauteilTemplates();
    if (!templates?.length) {
      return {
        status: "no_bauteile",
        message: "Es wurden keine Bauteil-Templates gefunden. Bitte prüfe die Stammdaten.",
      };
    }

    const options = templates.map((template) => ({
      id: template.id,
      name: template.name ?? template.bezeichnung ?? template.kuerzel ?? `Bauteil ${template.id}`,
    }));

    this.setConversation(chatId, {
      ...session,
      phase: "capture:select-bauteil",
      capture: {
        initialNote,
      },
      options,
    });

    return {
      status: "capture_select_bauteil",
      message: ["Welches Bauteil möchtest du erfassen?", describeOptions(options, { labelKey: "name" })].join("\n"),
      context: { phase: "capture:select-bauteil", options },
    };
  }

  async continueCaptureFlow({ chatId, session, message }) {
    const database = this.tools?.database;
    if (!database) {
      throw new Error("continueCaptureFlow: database tool nicht verfügbar.");
    }

    const { phase, options, path, capture = {} } = session;
    if (phase === "capture:select-bauteil") {
      const selected = resolveSelection(message, options, { labelKey: "name" });
      if (!selected) {
        const list = describeOptions(options, { labelKey: "name" });
        return {
          status: "capture_retry_bauteil",
          message: ["Bauteil nicht erkannt.", "Bitte wähle erneut:", list].join("\n"),
        };
      }

      const kapitelTemplates = await database.actions.listKapitelTemplatesByBauteilTemplate(selected.id);
      if (!kapitelTemplates?.length) {
        return {
          status: "capture_no_kapitel",
          message: `Für das Bauteil wurden keine Bereichskapitel gefunden. Bitte wähle ein anderes Bauteil oder breche mit "abbrechen" ab.`,
        };
      }

      const kapitelOptions = kapitelTemplates.map((template) => ({
        id: template.id,
        name: template.name ?? template.bezeichnung ?? template.kuerzel ?? `Kapitel ${template.id}`,
      }));

      this.setConversation(chatId, {
        ...session,
        phase: "capture:select-kapitel",
        options: kapitelOptions,
        capture: {
          ...capture,
          bauteilTemplate: selected,
        },
      });

      return {
        status: "capture_select_kapitel",
        message: ["Welches Bereichskapitel?", describeOptions(kapitelOptions, { labelKey: "name" })].join("\n"),
        context: { phase: "capture:select-kapitel", options: kapitelOptions },
      };
    }

    if (phase === "capture:select-kapitel") {
      const selected = resolveSelection(message, options, { labelKey: "name" });
      if (!selected) {
        const list = describeOptions(options, { labelKey: "name" });
        return {
          status: "capture_retry_kapitel",
          message: ["Bereichskapitel nicht erkannt.", "Bitte wähle erneut:", list].join("\n"),
        };
      }

      const rueckmeldungstypen = await database.actions.listRueckmeldungstypen();
      if (!rueckmeldungstypen?.length) {
        return {
          status: "capture_no_rueckmeldung",
          message: "Es wurden keine Rückmeldungsarten gefunden. Bitte prüfe die Stammdaten.",
        };
      }

      const rueckOptions = rueckmeldungstypen.map((typ) => ({
        id: typ.id,
        name: typ.name ?? typ.bezeichnung ?? `Rückmeldung ${typ.id}`,
      }));

      this.setConversation(chatId, {
        ...session,
        phase: "capture:select-rueckmeldung",
        options: rueckOptions,
        capture: {
          ...capture,
          kapitelTemplate: selected,
        },
      });

      return {
        status: "capture_select_rueckmeldung",
        message: ["Welche Rückmeldung?", describeOptions(rueckOptions, { labelKey: "name" })].join("\n"),
        context: { phase: "capture:select-rueckmeldung", options: rueckOptions },
      };
    }

    if (phase === "capture:select-rueckmeldung") {
      const selected = resolveSelection(message, options, { labelKey: "name" });
      if (!selected) {
        const list = describeOptions(options, { labelKey: "name" });
        return {
          status: "capture_retry_rueckmeldung",
          message: ["Rückmeldungsart nicht erkannt.", "Bitte wähle erneut:", list].join("\n"),
        };
      }

      return this.finalizeCapture({ chatId, session, selectedRueckmeldung: selected });
    }

    if (phase === "capture:confirm") {
      const choice = parseYesNo(message);
      if (choice == null) {
        return {
          status: "capture_retry_confirm",
          message: 'Bitte antworte mit ja oder nein, z.B. "ja".',
        };
      }

      if (!choice) {
        this.setConversation(chatId, { ...session, phase: "completed" });
        return {
          status: "capture_cancelled",
          message: "Alles klar, die Position wird nicht erstellt.",
        };
      }

      return this.performCaptureCreation({ chatId, session });
    }

    return {
      status: "capture_unknown_state",
      message: "Ich konnte deine Eingabe nicht verarbeiten. Tippe \"start\" für den Setup-Flow.",
    };
  }

  async finalizeCapture({ chatId, session, selectedRueckmeldung }) {
    const updatedCapture = {
      ...(session.capture ?? {}),
      rueckmeldungstyp: selectedRueckmeldung,
    };

    this.setConversation(chatId, {
      ...session,
      phase: "capture:confirm",
      capture: updatedCapture,
    });

    const summary = [
      "Bitte bestätige die Angaben:",
      `Bauteil: ${updatedCapture.bauteilTemplate?.name ?? "?"}`,
      `Bereichskapitel: ${updatedCapture.kapitelTemplate?.name ?? "?"}`,
      `Rückmeldungsart: ${selectedRueckmeldung.name ?? selectedRueckmeldung.id}`,
      updatedCapture.initialNote ? `Hinweis: ${updatedCapture.initialNote}` : null,
    ].filter(Boolean);

    return {
      status: "capture_confirm",
      message: [...summary, "Soll die Position angelegt werden? (ja/nein)"].join("\n"),
      context: { phase: "capture:confirm", capture: updatedCapture },
    };
  }

  async performCaptureCreation({ chatId, session }) {
    const database = this.tools?.database;
    if (!database) {
      throw new Error("performCaptureCreation: database tool nicht verfügbar.");
    }

    const { path, capture } = session;
    const baurundgangId = path?.baurundgang?.id;
    if (!baurundgangId) {
      return {
        status: "missing_setup",
        message: 'Der Baurundgang fehlt. Bitte starte den Setup-Flow erneut ("start").',
      };
    }

    const qsReport = await database.actions.ensureQsReportForBaurundgang({
      baurundgangId,
      kundeId: path?.kunde?.id,
      objektId: path?.objekt?.id,
    });

    if (!qsReport) {
      return {
        status: "capture_no_report",
        message: "QS-Report konnte nicht erstellt werden. Bitte versuche es erneut.",
      };
    }

    const payload = {
      baurundgangId,
      qsReportId: qsReport.id,
      bauteilTemplateId: capture?.bauteilTemplate?.id,
      kapitelTemplateId: capture?.kapitelTemplate?.id,
      rueckmeldungstypId: capture?.rueckmeldungstyp?.id,
      notiz: capture?.initialNote || "",
      frist: computeFristDate(14),
    };

    try {
      const created = await database.actions.createPositionWithDefaults(payload);
      const summary = composeSelectionSummary(path);

      this.setConversation(chatId, {
        ...session,
        phase: "completed",
        capture: null,
      });

      return {
        status: "capture_success",
        message: [
          "Position wurde angelegt.",
          summary ? `Kontext: ${summary}` : null,
          `Positions-ID: ${created?.id ?? "?"}`,
        ]
          .filter(Boolean)
          .join("\n"),
        context: { position: created, selection: path },
      };
    } catch (error) {
      this.logger.error("Fehler beim Erstellen der Position", { error });
      return {
        status: "capture_error",
        message: "Beim Anlegen der Position ist ein Fehler aufgetreten. Bitte versuche es erneut.",
      };
    }
  }
}
