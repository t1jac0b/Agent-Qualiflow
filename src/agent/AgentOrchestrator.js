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
    const formatted = datum ? new Date(datum).toISOString().slice(0, 10) : null;
    const label = path.baurundgang.typ?.name ?? (path.baurundgang.id ? `Baurundgang ${path.baurundgang.id}` : "Baurundgang");
    bits.push(`Baurundgang: ${formatted ? `${label} – ${formatted}` : label}`);
  }
  return bits.length ? bits.join(" • ") : null;
}

function describeBaurundgang(baurundgang) {
  if (!baurundgang) {
    return "Baurundgang";
  }
  return baurundgang.typ?.name ?? (baurundgang.id ? `Baurundgang ${baurundgang.id}` : "Baurundgang");
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

const EDIT_FIELD_DATABASE_KEYS = {
  kunde: {
    name: "name",
    adresse: "adresse",
    plz: "plz",
    ort: "ort",
    notiz: "notiz",
  },
  objekt: {
    name: "bezeichnung",
    adresse: "adresse",
    plz: "plz",
    ort: "ort",
    notiz: "notiz",
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

const EDIT_ENTITY_KEYWORDS = {
  kunde: ["kunde", "kunden"],
  objekt: ["objekt", "objekte", "bauobjekt"],
};

function detectEditEntityType(message, session) {
  const lower = message.toLowerCase();

  for (const [entityType, keywords] of Object.entries(EDIT_ENTITY_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return entityType;
    }
  }

  if (session?.path?.objekt) {
    return "objekt";
  }

  if (session?.path?.kunde) {
    return "kunde";
  }

  return null;
}

function buildUpdateSummary(entityType, entity, field, value) {
  const label = EDIT_FIELD_LABELS[entityType]?.[field] ?? field;
  const entityLabel =
    entityType === "kunde"
      ? entity?.name ?? `Kunde #${entity?.id ?? "?"}`
      : entity?.bezeichnung ?? entity?.name ?? `Objekt #${entity?.id ?? "?"}`;

  return `Aktualisiert ${entityLabel} – ${label}: ${value}`;
}

function mapEditUpdates(entityType, updates) {
  const mapping = EDIT_FIELD_DATABASE_KEYS[entityType];
  if (!mapping) {
    return { data: {}, applied: {} };
  }

  const data = {};
  const applied = {};

  for (const [key, value] of Object.entries(updates ?? {})) {
    if (value == null || value === "") {
      continue;
    }

    const mappedKey = mapping[key];
    if (mappedKey) {
      data[mappedKey] = value;
      applied[key] = value;
    }
  }

  return { data, applied };
}

function describeEntity(entityType, entity) {
  if (!entity) {
    return entityType === "objekt" ? "das Objekt" : "den Kunden";
  }

  if (entityType === "objekt") {
    return `Objekt "${entity.bezeichnung ?? entity.name ?? entity.id}"`;
  }

  return `Kunde "${entity.name ?? entity.id}"`;
}

function updatePathWithEntity(path, entityType, updatedEntity) {
  if (!path || !updatedEntity) {
    return path;
  }

  if (entityType === "kunde" && path.kunde?.id === updatedEntity.id) {
    return {
      ...path,
      kunde: {
        ...path.kunde,
        ...updatedEntity,
      },
    };
  }

  if (entityType === "objekt" && path.objekt?.id === updatedEntity.id) {
    return {
      ...path,
      objekt: {
        ...path.objekt,
        ...updatedEntity,
      },
    };
  }

  return path;
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

  async promptCustomerSelection({ chatId, database, prefix, pendingIntent } = {}) {
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

    const existing = this.getConversation(chatId);
    const options = kunden.map((kunde) => ({ id: kunde.id, name: kunde.name, inputValue: kunde.name }));
    const nextState = {
      phase: "select-customer",
      path: {},
      options,
      pendingIntent: pendingIntent ?? existing?.pendingIntent ?? null,
    };

    this.setConversation(chatId, { ...(existing ?? {}), ...nextState });

    const lines = [];
    if (prefix) {
      lines.push(prefix);
    }
    lines.push("Um welchen Kunden geht es? Du kannst einen Button anklicken oder den Namen eingeben.");

    return {
      status: "awaiting_customer",
      message: lines.join("\n"),
      context: { options, phase: "select-customer" },
    };
  }

  async beginConversation(chatId) {
    if (!chatId) {
      throw new Error("beginConversation: 'chatId' ist erforderlich.");
    }

    const database = this.tools?.database;
    if (!database) {
      throw new Error("beginConversation: database tool nicht verfügbar.");
    }

    const existing = this.getConversation(chatId);
    if (existing) {
      const summary = composeSelectionSummary(existing.path);
      const greeting = summary
        ? `Willkommen zurück! Aktuelle Auswahl: ${summary}.`
        : "Willkommen zurück! Wie kann ich dir helfen?";

      return {
        status: existing.phase ?? "resume",
        message: greeting,
        context: {
          phase: existing.phase,
          selection: existing.path,
          options: existing.options,
        },
      };
    }

    const prefix = "Hallo, ich bin der QualiFlow Agent.";
    return this.promptCustomerSelection({ chatId, database, prefix });
  }

  async ensureSetupContext(
    chatId,
    { database, requireBaurundgang = true, intent, originalMessage } = {},
  ) {
    const session = this.getConversation(chatId) ?? { phase: "idle", path: {} };
    const path = session.path ?? {};

    const pendingIntent = intent
      ? {
          intent,
          message: originalMessage,
          requires: { baurundgang: requireBaurundgang },
        }
      : session.pendingIntent ?? null;

    if (!path.kunde) {
      if (!database) {
        return {
          status: "missing_setup",
          message: "Bitte wähle zuerst Kunde, Objekt und Baurundgang aus.",
        };
      }

      return this.promptCustomerSelection({
        chatId,
        database,
        prefix: "Bitte wähle zuerst Kunde, Objekt und Baurundgang aus.",
        pendingIntent,
      });
    }

    if (!path.objekt) {
      if (!database) {
        return {
          status: "missing_setup",
          message: "Bitte wähle zuerst Kunde, Objekt und Baurundgang aus.",
        };
      }

      const objekte = await database.actions.listObjekteByKunde(path.kunde.id);
      if (!objekte?.length) {
        this.setConversation(chatId, {
          ...session,
          phase: "select-customer",
          options: session.options ?? [],
          pendingIntent,
        });
        return {
          status: "no_objects",
          message: `Für ${path.kunde.name ?? "den Kunden"} wurden keine Objekte gefunden. Bitte wähle einen anderen Kunden oder erfasse zuerst Objekte im System.`,
        };
      }

      const objektOptions = objekte.map((objekt) => ({
        id: objekt.id,
        bezeichnung: objekt.bezeichnung,
        inputValue: objekt.bezeichnung,
      }));

      this.setConversation(chatId, {
        ...session,
        phase: "select-object",
        path: { kunde: path.kunde },
        options: objektOptions,
        pendingIntent,
      });

      return {
        status: "awaiting_object",
        message: "Wähle das Objekt aus oder gib an, ob du ein neues Objekt erstellen möchtest.",
        context: { options: objektOptions, phase: "select-object" },
      };
    }

    if (requireBaurundgang && !path.baurundgang) {
      if (!database) {
        return {
          status: "missing_setup",
          message: "Bitte wähle zuerst Kunde, Objekt und Baurundgang aus.",
        };
      }

      let baurundgaenge = await database.actions.listBaurundgaengeByObjekt(path.objekt.id);
      let createdAuto = 0;
      if (!baurundgaenge?.length) {
        const autoCreate = await database.actions.autoCreateBaurundgaengeForObjekt(path.objekt.id);
        createdAuto = autoCreate?.created ?? 0;
        if (createdAuto > 0) {
          baurundgaenge = await database.actions.listBaurundgaengeByObjekt(path.objekt.id);
        }
      }

      if (!baurundgaenge?.length) {
        this.setConversation(chatId, {
          ...session,
          phase: "select-object",
          options: session.options ?? [],
          pendingIntent,
        });
        return {
          status: "no_baurundgaenge",
          message: `Für das Objekt "${path.objekt.bezeichnung}" konnten keine Baurundgänge angelegt werden. Bitte prüfe die Stammdaten zu den Baurundgang-Typen.`,
        };
      }

      const baurundgangOptions = baurundgaenge.map((item) => ({
        ...item,
        label: item.typ?.name ?? (item.id ? `Baurundgang ${item.id}` : "Baurundgang"),
        inputValue: String(item.id),
      }));

      this.setConversation(chatId, {
        ...session,
        phase: "select-baurundgang",
        path: { ...path },
        options: baurundgangOptions,
        pendingIntent,
      });

      const intro =
        createdAuto > 0
          ? `Ich habe für ${path.objekt.bezeichnung} automatisch ${createdAuto} Standard-Baurundgänge angelegt.`
          : "Welcher Baurundgang soll bearbeitet werden?";

      return {
        status: "awaiting_baurundgang",
        message: `${intro} Bitte wähle einen Baurundgang über die Buttons oder gib die ID ein.`,
        context: { options: baurundgangOptions, phase: "select-baurundgang" },
      };
    }

    if (database) {
      const resumed = await this.resumePendingIntentIfReady({ chatId, database });
      if (resumed) {
        return resumed;
      }
    }

    return null;
  }

  async resumePendingIntentIfReady({ chatId, database }) {
    const session = this.getConversation(chatId);
    if (!session?.pendingIntent) {
      return null;
    }

    const pending = session.pendingIntent;
    const path = session.path ?? {};
    const requiresBaurundgang = pending.requires?.baurundgang ?? true;
    const contextReady = requiresBaurundgang
      ? Boolean(path.baurundgang?.id)
      : Boolean(path.objekt?.id ?? path.kunde?.id);

    if (!contextReady) {
      return null;
    }

    const updatedSession = { ...session, pendingIntent: null };
    this.setConversation(chatId, updatedSession);

    return this.routeIntent({
      chatId,
      intent: pending.intent,
      message: pending.message,
      session: updatedSession,
      database,
      skipEnsure: true,
    });
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
    const intent = detectIntent(trimmed);

    if (session.phase?.startsWith("capture:")) {
      if (intent && intent !== INTENTS.CAPTURE) {
        return this.routeIntent({ chatId, intent, message: trimmed, session, database });
      }
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
      if (intent && intent !== INTENTS.EDIT) {
        return this.routeIntent({ chatId, intent, message: trimmed, session, database });
      }
      return this.continueEditFlow({ chatId, session, message: trimmed, database });
    }

    if (session.phase === "delete:confirm") {
      if (intent && intent !== INTENTS.DELETE) {
        return this.routeIntent({ chatId, intent, message: trimmed, session, database });
      }
      return this.continueDeleteFlow({ chatId, session, message: trimmed });
    }

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
          return this.routeIntent({ chatId, intent, message: trimmed, session, database });
        }
      }

      return this.promptCustomerSelection({ chatId, database });
    }

    if (session.phase === "select-customer") {
      if (intent) {
        const intentResult = await this.routeIntent({ chatId, intent, message: trimmed, session, database });
        const reminder = "Lass uns mit der Kundenauswahl weitermachen. Bitte nutze die Buttons oder gib den Kundennamen ein.";
        const context = { ...(intentResult.context ?? {}) };
        if (!context.options && session.options) context.options = session.options;
        context.phase = session.phase;
        return {
          ...intentResult,
          message: [intentResult.message, reminder].filter(Boolean).join("\n\n"),
          context,
        };
      }

      const selected = resolveSelection(trimmed, session.options, { labelKey: "name" });
      if (!selected) {
        return {
          status: "retry_customer",
          message: "Ich konnte den Kunden nicht zuordnen. Bitte wähle ihn über die Buttons oder gib den Namen ein.",
          context: { options: session.options, phase: session.phase },
        };
      }

      const objekte = await database.actions.listObjekteByKunde(selected.id);
      if (!objekte?.length) {
        this.setConversation(chatId, {
          phase: "select-customer",
          path: session.path,
          options: session.options,
          pendingIntent: session.pendingIntent ?? null,
        });
        return {
          status: "no_objects",
          message: `Für ${selected.name} wurden keine Objekte gefunden. Bitte wähle einen anderen Kunden oder erfasse zuerst Objekte im System.`,
        };
      }

      const objektOptions = objekte.map((objekt) => ({
        id: objekt.id,
        bezeichnung: objekt.bezeichnung,
        inputValue: objekt.bezeichnung,
      }));

      this.setConversation(chatId, {
        phase: "select-object",
        path: { ...session.path, kunde: selected },
        options: objektOptions,
        pendingIntent: session.pendingIntent ?? null,
      });

      return {
        status: "awaiting_object",
        message: "Wähle das Objekt aus oder gib an, ob du ein neues Objekt erstellen möchtest.",
        context: { options: objektOptions, phase: "select-object" },
      };
    }

    if (session.phase === "select-object") {
      if (intent) {
        const intentResult = await this.routeIntent({ chatId, intent, message: trimmed, session, database });
        const reminder = "Sag mir bitte weiterhin, welches Objekt zum Kunden gehört. Du kannst einen Button anklicken oder den Namen eingeben.";
        const context = { ...(intentResult.context ?? {}) };
        if (!context.options && session.options) context.options = session.options;
        context.phase = session.phase;
        return {
          ...intentResult,
          message: [intentResult.message, reminder].filter(Boolean).join("\n\n"),
          context,
        };
      }

      const selected = resolveSelection(trimmed, session.options, { labelKey: "bezeichnung" });
      if (!selected) {
        return {
          status: "retry_object",
          message: "Ich habe das Objekt nicht erkannt. Bitte wähle es über die Buttons oder gib den Namen ein.",
          context: { options: session.options, phase: session.phase },
        };
      }

      let baurundgaenge = await database.actions.listBaurundgaengeByObjekt(selected.id);
      let createdAuto = 0;
      if (!baurundgaenge?.length) {
        const autoCreate = await database.actions.autoCreateBaurundgaengeForObjekt(selected.id);
        createdAuto = autoCreate?.created ?? 0;
        if (createdAuto > 0) {
          baurundgaenge = await database.actions.listBaurundgaengeByObjekt(selected.id);
        }
      }

      if (!baurundgaenge?.length) {
        this.setConversation(chatId, {
          phase: "select-object",
          path: session.path,
          options: session.options,
          pendingIntent: session.pendingIntent ?? null,
        });
        return {
          status: "no_baurundgaenge",
          message: `Für das Objekt "${selected.bezeichnung}" konnten keine Baurundgänge angelegt werden. Bitte prüfe die Stammdaten zu den Baurundgang-Typen.`,
        };
      }

      const baurundgangOptions = baurundgaenge.map((item) => {
        return {
          ...item,
          label: item.typ?.name ?? (item.id ? `Baurundgang ${item.id}` : "Baurundgang"),
          inputValue: String(item.id),
        };
      });

      this.setConversation(chatId, {
        phase: "select-baurundgang",
        path: { ...session.path, objekt: selected },
        options: baurundgangOptions,
        pendingIntent: session.pendingIntent ?? null,
      });

      const intro =
        createdAuto > 0
          ? `Ich habe für ${selected.bezeichnung} automatisch ${createdAuto} Standard-Baurundgänge angelegt.`
          : "Welcher Baurundgang soll bearbeitet werden?";

      return {
        status: "awaiting_baurundgang",
        message: `${intro} Bitte wähle einen Baurundgang über die Buttons oder gib die ID ein.`,
        context: { options: baurundgangOptions, phase: "select-baurundgang" },
      };
    }

    if (session.phase === "select-baurundgang") {
      if (intent) {
        const intentResult = await this.routeIntent({ chatId, intent, message: trimmed, session, database });
        const reminder = "Bitte wähle weiterhin den passenden Baurundgang aus.";
        const context = { ...(intentResult.context ?? {}) };
        if (!context.options && session.options) context.options = session.options;
        context.phase = session.phase;
        return {
          ...intentResult,
          message: [intentResult.message, reminder].filter(Boolean).join("\n\n"),
          context,
        };
      }

      const selected = resolveSelection(trimmed, session.options, {
        labelKey: "id",
        valueKey: "id",
      });

      if (!selected) {
        return {
          status: "retry_baurundgang",
          message: "Ich konnte den Baurundgang nicht zuordnen. Bitte wähle ihn über die Buttons oder gib die ID ein.",
          context: { options: session.options, phase: session.phase },
        };
      }

      this.setConversation(chatId, {
        phase: "pruefpunkte",
        path: { ...session.path, baurundgang: selected },
      });

      const resumed = await this.resumePendingIntentIfReady({ chatId, database });
      if (resumed) {
        return resumed;
      }

      return {
        status: "awaiting_pruefpunkte",
        message: "Möchtest du Prüfpunkte erfassen? (ja/nein)",
        context: { phase: "pruefpunkte" },
      };
    }

    if (session.phase === "pruefpunkte") {
      if (intent) {
        const intentResult = await this.routeIntent({ chatId, intent, message: trimmed, session, database });
        const reminder = "Bitte gib mir Bescheid, ob wir Prüfpunkte erfassen sollen (ja/nein).";
        const context = { ...(intentResult.context ?? {}) };
        context.phase = session.phase;
        return {
          ...intentResult,
          message: [intentResult.message, reminder].filter(Boolean).join("\n\n"),
          context,
        };
      }

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

      const resumed = await this.resumePendingIntentIfReady({ chatId, database });
      if (resumed) {
        return resumed;
      }

      return {
        status: "setup_complete",
        message: `${confirmation} Setup abgeschlossen. Du kannst jetzt Positionen erfassen (Foto/Notiz).`,
        context: { selection: path },
      };
    }

    if (session.phase === "completed") {
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
          return this.routeIntent({ chatId, intent, message: trimmed, session, database });
        }
      }

      return {
        status: "completed",
        message: "Setup ist bereits abgeschlossen. Was möchtest du als Nächstes tun?",
        context: { selection: session.path },
      };
    }

    return {
      status: "unknown_state",
      message: "Ich konnte deine Eingabe nicht verarbeiten. Tippe \"start\", um den Setup-Flow neu zu beginnen.",
    };
  }

  async routeIntent({ chatId, intent, message, session, database, skipEnsure = false }) {
    switch (intent) {
      case INTENTS.CAPTURE:
        return this.beginCaptureFlow({ chatId, session, initialNote: extractInitialNote(message) });
      case INTENTS.DELETE:
        return this.handleDeleteIntent({ chatId, message, session });
      case INTENTS.EDIT:
        return this.handleEditIntent({ chatId, message, session, database });
      case INTENTS.QUERY:
        return this.handleQueryIntent({ chatId, message, session, database, skipEnsure });
      default:
        return {
          status: "unhandled_intent",
          message: "Ich konnte deine Eingabe nicht zuordnen.",
        };
    }
  }

  async handleEditIntent({ chatId, message, session, database }) {
    if (!database) {
      throw new Error("handleEditIntent: database tool nicht verfügbar.");
    }

    const entityType = detectEditEntityType(message, session);
    if (!entityType) {
      return {
        status: "edit_unknown_entity",
        message: "Möchtest du einen Kunden oder ein Objekt bearbeiten? Bitte gib das an.",
      };
    }

    let entity = entityType === "kunde" ? session.path?.kunde : session.path?.objekt;
    const extractedName = extractEntityName(message, entityType === "kunde" ? "kunde" : "objekt");

    if (!entity && extractedName) {
      try {
        if (entityType === "kunde") {
          entity = await database.actions.findKundeByName(extractedName);
        } else {
          const kundeId = session.path?.kunde?.id;
          entity = await database.actions.findObjektByName({ name: extractedName, kundeId });
        }
      } catch (error) {
        this.logger.error("handleEditIntent: Entity lookup fehlgeschlagen", { error, entityType, name: extractedName });
      }
    }

    if (!entity) {
      const hint =
        entityType === "objekt"
          ? "Bitte wähle zuerst ein Objekt im Setup (Kunde → Objekt → Baurundgang)."
          : "Bitte wähle zuerst einen Kunden im Setup (Buttons oder Eingabe).";
      return {
        status: "edit_missing_context",
        message: `Ich konnte ${entityType === "objekt" ? "kein Objekt" : "keinen Kunden"} zuordnen. ${hint}`,
      };
    }

    const updates = extractFieldUpdates(message);
    const { data, applied } = mapEditUpdates(entityType, updates);

    if (Object.keys(data).length) {
      try {
        const updatedEntity =
          entityType === "kunde"
            ? await database.actions.updateKundeFields({ id: entity.id, data })
            : await database.actions.updateObjektFields({ id: entity.id, data });

        const newPath = updatePathWithEntity(session.path, entityType, updatedEntity);
        this.setConversation(chatId, {
          ...session,
          phase: "completed",
          path: newPath,
          options: null,
          edit: null,
        });

        const lines = Object.entries(applied).map(([field, value]) =>
          buildUpdateSummary(entityType, updatedEntity, field, value),
        );
        const summary = composeSelectionSummary(newPath);

        return {
          status: "edit_success",
          message: [...lines, summary ? `Kontext: ${summary}` : null].filter(Boolean).join("\n"),
          context: { selection: newPath },
        };
      } catch (error) {
        this.logger.error("handleEditIntent: Update fehlgeschlagen", { error, entityType, entityId: entity.id });
        return {
          status: "edit_error",
          message: "Beim Aktualisieren ist ein Fehler aufgetreten. Bitte versuche es erneut.",
        };
      }
    }

    const options = listEditFieldOptions(entityType);
    this.setConversation(chatId, {
      ...session,
      phase: "edit:select-field",
      options,
      edit: {
        entityType,
        entityId: entity.id,
        entityName:
          entityType === "kunde"
            ? entity.name ?? extractedName ?? `Kunde #${entity.id}`
            : entity.bezeichnung ?? entity.name ?? extractedName ?? `Objekt #${entity.id}`,
      },
    });

    return {
      status: "edit_select_field",
      message: `Welches Feld soll für ${describeEntity(entityType, entity)} geändert werden? Bitte nutze die Buttons oder gib den Feldnamen ein.`,
      context: { options, phase: "edit:select-field" },
    };
  }

  async continueEditFlow({ chatId, session, message, database }) {
    if (!database) {
      throw new Error("continueEditFlow: database tool nicht verfügbar.");
    }

    const editState = session.edit;
    if (!editState) {
      this.setConversation(chatId, { ...session, phase: "completed", options: null });
      return {
        status: "edit_reset",
        message: "Bearbeitungsmodus zurückgesetzt. Was möchtest du tun?",
      };
    }

    if (isCancelCommand(message)) {
      this.setConversation(chatId, { ...session, phase: "completed", options: null, edit: null });
      return {
        status: "edit_cancelled",
        message: "Alles klar, keine Änderungen vorgenommen.",
        context: { selection: session.path },
      };
    }

    if (session.phase === "edit:select-field") {
      const choice = resolveEditFieldChoice(editState.entityType, message);
      if (!choice) {
        return {
          status: "edit_retry_field",
          message: "Ich konnte das Feld nicht zuordnen. Bitte wähle eines der Buttons oder gib den Feldnamen ein.",
          context: { options: session.options, phase: session.phase },
        };
      }

      this.setConversation(chatId, {
        ...session,
        phase: "edit:await-value",
        options: null,
        edit: {
          ...editState,
          field: choice.field,
          fieldLabel: choice.label,
        },
      });

      return {
        status: "edit_await_value",
        message: `Bitte gib den neuen Wert für ${choice.label} an.`,
      };
    }

    if (session.phase === "edit:await-value") {
      const value = normalizeInput(message);
      if (!value) {
        return {
          status: "edit_retry_value",
          message: "Der neue Wert darf nicht leer sein. Bitte gib einen Text ein.",
        };
      }

      const updates = { [editState.field]: value };
      const { data } = mapEditUpdates(editState.entityType, updates);
      if (!Object.keys(data).length) {
        return {
          status: "edit_retry_value",
          message: "Ich konnte den Wert nicht zuordnen. Bitte formuliere ihn erneut.",
        };
      }

      try {
        const updatedEntity =
          editState.entityType === "kunde"
            ? await database.actions.updateKundeFields({ id: editState.entityId, data })
            : await database.actions.updateObjektFields({ id: editState.entityId, data });

        const newPath = updatePathWithEntity(session.path, editState.entityType, updatedEntity);
        this.setConversation(chatId, {
          ...session,
          phase: "completed",
          path: newPath,
          edit: null,
          options: null,
        });

        const summaryLine = buildUpdateSummary(editState.entityType, updatedEntity, editState.field, value);
        const contextSummary = composeSelectionSummary(newPath);

        return {
          status: "edit_success",
          message: [summaryLine, contextSummary ? `Kontext: ${contextSummary}` : null].filter(Boolean).join("\n"),
          context: { selection: newPath },
        };
      } catch (error) {
        this.logger.error("continueEditFlow: Update fehlgeschlagen", {
          error,
          entityType: editState.entityType,
          entityId: editState.entityId,
        });
        return {
          status: "edit_error",
          message: "Beim Aktualisieren ist ein Fehler aufgetreten. Bitte versuche es erneut.",
        };
      }
    }

    return {
      status: "edit_unknown_state",
      message: "Ich konnte die Bearbeitung nicht fortsetzen. Bitte starte den Setup-Flow erneut oder wähle eine andere Aktion.",
    };
  }

  async handleDeleteIntent({ chatId, message, session }) {
    const entityType = detectEditEntityType(message, session);
    if (!entityType) {
      return {
        status: "delete_unknown_entity",
        message: "Bitte sag mir, ob du einen Kunden oder ein Objekt löschen möchtest.",
      };
    }

    const entity = entityType === "kunde" ? session.path?.kunde : session.path?.objekt;
    if (!entity) {
      return {
        status: "delete_missing_context",
        message: "Ich kann derzeit nichts löschen, da kein passender Kontext ausgewählt ist.",
      };
    }

    const label = describeEntity(entityType, entity);

    this.setConversation(chatId, {
      ...session,
      phase: "delete:confirm",
      delete: {
        entityType,
        label,
      },
    });

    return {
      status: "delete_confirm",
      message: `${label} soll gelöscht werden. Bist du dir absolut sicher? Bitte bestätige mit ja/nein.`,
    };
  }

  async continueDeleteFlow({ chatId, session, message }) {
    const choice = parseYesNo(message);
    if (choice == null) {
      return {
        status: "delete_retry",
        message: 'Bitte bestätige mit ja oder nein (z.B. "ja" / "nein").',
      };
    }

    const label = session.delete?.label ?? "Das Element";

    this.setConversation(chatId, {
      ...session,
      phase: "completed",
      delete: null,
    });

    if (!choice) {
      return {
        status: "delete_cancelled",
        message: `${label} bleibt unverändert. Danke für die Rückmeldung!`,
        context: { selection: session.path },
      };
    }

    return {
      status: "delete_guardrail",
      message: `${label} wird nicht automatisch gelöscht.
Zur Sicherheit erfolgt eine Löschung nur nach expliziter Freigabe durch den Administrator.`,
      context: { selection: session.path },
    };
  }

  async handleQueryIntent({ chatId, message, session, database, skipEnsure = false }) {
    if (!database) {
      throw new Error("handleQueryIntent: database tool nicht verfügbar.");
    }

    if (!skipEnsure) {
      const ensured = await this.ensureSetupContext(chatId, {
        database,
        intent: INTENTS.QUERY,
        originalMessage: message,
      });
      if (ensured) {
        return ensured;
      }
    }

    const lower = message.toLowerCase();
    const path = session.path ?? this.getConversation(chatId)?.path;

    if (!path?.baurundgang?.id) {
      return {
        status: "query_missing_context",
        message: "Bitte wähle zuerst Kunde, Objekt und Baurundgang aus, bevor du Auswertungen abfragst.",
      };
    }

    if (lower.includes("rückmeldung") || lower.includes("rueckmeldung")) {
      try {
        const summary = await database.actions.summarizeRueckmeldungen({ baurundgangId: path.baurundgang.id });
        if (!summary.length) {
          return {
            status: "query_rueckmeldungen_empty",
            message: "Es wurden noch keine Rückmeldungen erfasst.",
            context: { selection: path },
          };
        }

        const items = summary.map((entry) =>
          `• ${entry.rueckmeldung}: ${entry.offen} offen, ${entry.erledigt} erledigt (gesamt ${entry.gesamt})`,
        );
        const header = composeSelectionSummary(path);

        return {
          status: "query_rueckmeldungen",
          message: [header ? `Kontext: ${header}` : null, "Rückmeldungsübersicht:", ...items]
            .filter(Boolean)
            .join("\n"),
          context: { selection: path },
        };
      } catch (error) {
        this.logger.error("handleQueryIntent: Rueckmeldungs-Abfrage fehlgeschlagen", {
          error,
          baurundgangId: path.baurundgang.id,
        });
        return {
          status: "query_error",
          message: "Die Rückmeldungen konnten nicht geladen werden. Bitte versuche es erneut.",
        };
      }
    }

    return {
      status: "query_unknown",
      message: "Diese Frage kann ich noch nicht beantworten. Versuche es z.B. mit \"Welche Rückmeldungen fallen an?\"",
      context: { selection: path },
    };
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
        message: "Bitte schließe zuerst den Setup-Flow mit Kunde, Objekt und Baurundgang ab.",
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
      inputValue: template.name ?? template.bezeichnung ?? template.kuerzel ?? `Bauteil ${template.id}`,
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
      message: "Welches Bauteil möchtest du erfassen? Bitte nutze die Buttons oder gib den Namen ein.",
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
        return {
          status: "capture_retry_bauteil",
          message: "Bauteil nicht erkannt. Bitte wähle eines der vorgeschlagenen Bauteile oder tippe den exakten Namen.",
          context: { options, phase },
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
        inputValue: template.name ?? template.bezeichnung ?? template.kuerzel ?? `Kapitel ${template.id}`,
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
        message: "Welches Bereichskapitel soll es sein? Bitte nutze die Buttons oder gib den Namen ein.",
        context: { phase: "capture:select-kapitel", options: kapitelOptions },
      };
    }

    if (phase === "capture:select-kapitel") {
      const selected = resolveSelection(message, options, { labelKey: "name" });
      if (!selected) {
        return {
          status: "capture_retry_kapitel",
          message: "Bereichskapitel nicht erkannt. Bitte wähle eines der vorgeschlagenen Kapitel oder tippe den exakten Namen.",
          context: { options, phase },
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
        inputValue: typ.name ?? typ.bezeichnung ?? `Rückmeldung ${typ.id}`,
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
        message: "Welche Rückmeldung möchtest du wählen? Bitte nutze die Buttons oder gib den Namen ein.",
        context: { phase: "capture:select-rueckmeldung", options: rueckOptions },
      };
    }

    if (phase === "capture:select-rueckmeldung") {
      const selected = resolveSelection(message, options, { labelKey: "name" });
      if (!selected) {
        return {
          status: "capture_retry_rueckmeldung",
          message: "Rückmeldungsart nicht erkannt. Bitte wähle eine der vorgeschlagenen Optionen oder tippe den exakten Namen.",
          context: { options, phase },
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
      message: "Ich konnte deine Eingabe nicht verarbeiten. Bitte starte den Setup-Flow erneut oder wähle eine andere Aktion.",
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
        message: "Der Baurundgang fehlt. Bitte wähle Kunde, Objekt und Baurundgang erneut aus.",
      };
    }

    if (!capture?.bauteilTemplate?.id || !capture?.kapitelTemplate?.id || !capture?.rueckmeldungstyp?.id) {
      return {
        status: "capture_missing_selection",
        message: "Für die Positionserfassung müssen Bauteil, Bereichskapitel und Rückmeldung gesetzt sein. Bitte starte den Capture-Flow erneut.",
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
