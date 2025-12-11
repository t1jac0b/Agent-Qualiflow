import { createLogger } from "../utils/logger.js";
import { __test__ as QsRundgangTest } from "./qsRundgang/QsRundgangAgent.js";

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
  if (!input) return null;
  // Zuerst direkter Parse (z.B. "1", "2")
  let value = Number.parseInt(input, 10);
  if (Number.isNaN(value)) {
    // Fallback: erste Ganzzahl im Text finden (z.B. "die nummer 1", "Nummer 2 bitte")
    const match = String(input).match(/\b(\d+)\b/);
    if (!match) return null;
    value = Number.parseInt(match[1], 10);
    if (Number.isNaN(value)) return null;
  }

  if (value < 1 || value > optionsLength) return null;
  return value - 1;
}

function findOptionByIdOrText(options, input, { labelKey = "name", valueKey = "id" }) {
  const normalized = input.toLowerCase();

  const normalizeValue = (value) => {
    if (value == null) return null;
    const text = String(value).trim();
    return text ? text.toLowerCase() : null;
  };

  const stripPrefix = (value) => {
    if (!value) return null;
    return value.replace(/^br\s*\d+\s*/i, "").trim();
  };

  const getNestedValue = (option, key) => {
    if (!option || !key) return null;
    if (!key.includes(".")) {
      return option[key];
    }
    return key.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), option);
  };

  const candidateKeys = [
    valueKey,
    labelKey,
    "label",
    "name",
    "bezeichnung",
    "title",
    "typ.name",
  ];

  for (const option of options) {
    const idValue = normalizeValue(option?.[valueKey]);
    if (idValue && idValue === normalized) {
      return option;
    }
  }

  for (const option of options) {
    const seen = new Set();
    for (const key of candidateKeys) {
      const raw = getNestedValue(option, key);
      const normalizedValue = normalizeValue(raw);
      if (normalizedValue && !seen.has(normalizedValue)) {
        seen.add(normalizedValue);
        if (normalizedValue === normalized) {
          return option;
        }
      }

      const stripped = normalizeValue(stripPrefix(typeof raw === "string" ? raw : null));
      if (stripped && !seen.has(stripped)) {
        seen.add(stripped);
        if (stripped === normalized) {
          return option;
        }
      }
    }
  }

  return null;
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

function isFinishCommand(input) {
  const normalized = input.toLowerCase();
  return normalized === "fertig" || normalized === "beenden" || normalized === "ende";
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

function truncateText(text, maxLength = 120) {
  if (text == null) return "";
  const normalized = String(text).trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatStatusLabel(status) {
  if (!status) return "unbekannt";
  const normalized = status.toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatPositionsSummary(positions = [], { maxItems = 5 } = {}) {
  if (!positions.length) {
    return { lines: [], total: 0 };
  }

  const lines = positions.slice(0, maxItems).map((position) => {
    const number = position.positionsnummer ?? position.id;
    const status = position.erledigt ? "erledigt" : "offen";
    const area = position.bereichKapitel?.name ?? position.bereichstitel ?? null;
    const rueckmeldung = position.rueckmeldungstyp?.name ?? null;
    const remark = position.bemerkung ? truncateText(position.bemerkung, 80) : null;
    const photoCount = Array.isArray(position.fotos) ? position.fotos.length : 0;

    const infoParts = [
      rueckmeldung && rueckmeldung !== area ? rueckmeldung : null,
      remark ? `Notiz: ${remark}` : null,
      photoCount ? `${photoCount} Foto${photoCount > 1 ? "s" : ""}` : null,
    ].filter(Boolean);

    const detailSuffix = infoParts.length ? ` (${infoParts.join(", ")})` : "";
    const label = area ?? rueckmeldung ?? `Position ${number}`;
    return `#${number} ${label} – ${status}${detailSuffix}`;
  });

  if (positions.length > maxItems) {
    lines.push(`… und ${positions.length - maxItems} weitere`);
  }

  return { lines, total: positions.length };
}

function formatPruefpunkteSummary(pruefpunkte = [], { maxItems = 5 } = {}) {
  if (!pruefpunkte.length) {
    return { lines: [], total: 0 };
  }

  const lines = pruefpunkte.slice(0, maxItems).map((item) => {
    const status = item.erledigt ? "erledigt" : "offen";
    const note = item.notiz ? truncateText(item.notiz, 60) : null;
    const suffix = note ? ` – ${note}` : "";
    return `${item.bezeichnung}${suffix} (${status})`;
  });

  if (pruefpunkte.length > maxItems) {
    lines.push(`… und ${pruefpunkte.length - maxItems} weitere`);
  }

  return { lines, total: pruefpunkte.length };
}

function formatRueckmeldungSummaryList(summary = []) {
  if (!Array.isArray(summary) || !summary.length) {
    return [];
  }

  return summary.map((item) => {
    const offen = item.offen ?? 0;
    const erledigt = item.erledigt ?? 0;
    const gesamt = item.gesamt ?? offen + erledigt;
    return `${item.rueckmeldung ?? "Unbekannt"}: offen ${offen}, erledigt ${erledigt}, gesamt ${gesamt}`;
  });
}

function withBullets(lines = []) {
  return lines.filter(Boolean).map((line) => `• ${line}`);
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
    const label = path.baurundgang.label ?? path.baurundgang.typ?.name ?? (path.baurundgang.id ? `Baurundgang ${path.baurundgang.id}` : "Baurundgang");
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
  START: "start",
  PLAN: "plan",
};

// Zentrale Übersicht aller verwendeten Status-Codes für konsistente Rückgaben
const STATUS_CODES = {
  // Setup & Customer Selection
  AWAITING_CUSTOMER: "awaiting_customer",
  RETRY_CUSTOMER: "retry_customer",
  NO_CUSTOMERS: "no_customers",
  
  // Object Selection
  AWAITING_OBJEKT: "awaiting_objekt",
  RETRY_OBJEKT: "retry_objekt",
  NO_OBJEKTE: "no_objekte",
  
  // Baurundgang Selection
  AWAITING_BAURUNDGANG: "awaiting_baurundgang",
  RETRY_BAURUNDGANG: "retry_baurundgang",
  NO_BAURUNDGAENGE: "no_baurundgaenge",
  
  // Planning (PLAN Intent)
  PLAN_SELECT_BAURUNDGANG: "plan_select_baurundgang",
  PLAN_RETRY_BAURUNDGANG: "plan_retry_baurundgang",
  PLAN_AWAIT_DATE: "plan_await_date",
  PLAN_RETRY_DATE: "plan_retry_date",
  PLAN_SUCCESS: "plan_success",
  PLAN_CANCELLED: "plan_cancelled",
  PLAN_MISSING_BAURUNDGANG: "plan_missing_baurundgang",
  PLAN_UPDATE_ERROR: "plan_update_error",
  PLAN_UNKNOWN_STATE: "plan_unknown_state",
  
  // Capture Flow
  CAPTURE_SELECT_BAUTEIL: "capture_select_bauteil",
  CAPTURE_RETRY_BAUTEIL: "capture_retry_bauteil",
  CAPTURE_SELECT_KAPITEL: "capture_select_kapitel",
  CAPTURE_RETRY_KAPITEL: "capture_retry_kapitel",
  CAPTURE_SELECT_RUECKMELDUNG: "capture_select_rueckmeldung",
  CAPTURE_RETRY_RUECKMELDUNG: "capture_retry_rueckmeldung",
  CAPTURE_CONFIRM: "capture_confirm",
  CAPTURE_RETRY_CONFIRM: "capture_retry_confirm",
  CAPTURE_SUCCESS: "capture_success",
  CAPTURE_CANCELLED: "capture_cancelled",
  CAPTURE_ERROR: "capture_error",
  CAPTURE_MISSING_SELECTION: "capture_missing_selection",
  CAPTURE_NO_REPORT: "capture_no_report",
  CAPTURE_UNKNOWN_STATE: "capture_unknown_state",
  
  // Edit Flow
  EDIT_SELECT_FIELD: "edit_select_field",
  EDIT_RETRY_FIELD: "edit_retry_field",
  EDIT_ENTER_VALUE: "edit_enter_value",
  EDIT_RETRY_VALUE: "edit_retry_value",
  EDIT_SUCCESS: "edit_success",
  EDIT_ERROR: "edit_error",
  EDIT_UNKNOWN_ENTITY: "edit_unknown_entity",
  EDIT_MISSING_CONTEXT: "edit_missing_context",
  EDIT_UNKNOWN_STATE: "edit_unknown_state",
  
  // Delete Flow
  DELETE_CONFIRM: "delete_confirm",
  DELETE_RETRY: "delete_retry",
  DELETE_CANCELLED: "delete_cancelled",
  DELETE_GUARDRAIL: "delete_guardrail",
  DELETE_UNKNOWN_ENTITY: "delete_unknown_entity",
  DELETE_MISSING_CONTEXT: "delete_missing_context",
  
  // Query Flow
  QUERY_BAURUNDGAENGE_LIST: "query_baurundgaenge_list",
  QUERY_BAURUNDGAENGE_EMPTY: "query_baurundgaenge_empty",
  QUERY_MISSING_CONTEXT: "query_missing_context",
  QSREPORT_AVAILABLE: "qsreport_available",
  QSREPORT_GENERATING: "qsreport_generating",
  QSREPORT_ERROR: "qsreport_error",
  PRUEFPUNKTE_LIST: "pruefpunkte_list",
  PRUEFPUNKTE_EMPTY: "pruefpunkte_empty",
  PRUEFPUNKTE_ENTER_TITLE: "pruefpunkte_enter_title",
  PRUEFPUNKTE_RETRY_TITLE: "pruefpunkte_retry_title",
  PRUEFPUNKTE_ENTER_NOTE: "pruefpunkte_enter_note",
  PRUEFPUNKTE_SAVED: "pruefpunkte_saved",
  PRUEFPUNKTE_LIST_HINT: "pruefpunkte_list_hint",
  PRUEFPUNKTE_TOGGLE_ERROR: "pruefpunkte_toggle_error",
  PRUEFPUNKTE_UNKNOWN_STATE: "pruefpunkte_unknown_state",
  
  // Start Flow
  START_SUCCESS: "start_success",
  START_ERROR: "start_error",
  
  // General
  MISSING_SETUP: "missing_setup",
  UNKNOWN_INTENT: "unknown_intent",
  RESUME: "resume",
  COMPLETED: "completed",
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
   if (/(avor|planung|plane|planen)/i.test(lower)) {
    return INTENTS.PLAN;
  }
  if (/(start|starte|starten|begin|beginne|beginnen|durchführ)/i.test(lower)) {
    return INTENTS.START;
  }
  // Treat report-related phrases as queries (e.g., "bericht", "report", "qs report", "pdf", "ansehen")
  if (/(bericht|report|qs[- ]?report|pdf|ansehen|exportieren|generier|erstell)/i.test(lower)) {
    return INTENTS.QUERY;
  }
  if (lower.includes("?") || /(welche|welcher|welches|was|zeige|zeigen|anzeigen|liste|wie viele|status)/i.test(lower)) {
    return INTENTS.QUERY;
  }
  if (/(baurundgänge|baurundgaenge|baurundgang|rundgänge|rundgaenge)/i.test(lower)) {
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

function mapTemplateRecordForCapture(record) {
  const kapitelTemplate = record?.kapitelTemplate;
  const bauteilTemplate = kapitelTemplate?.bauteilTemplate;

  const bauteilName = bauteilTemplate?.name ?? null;
  const kapitelName = kapitelTemplate?.name ?? null;
  const text = record.text ?? "";

  return {
    id: record.id,
    text,
    textLower: text.toLowerCase(),
    bauteilTemplateId: bauteilTemplate?.id ?? null,
    bauteilName,
    bauteilNameLower: bauteilName?.toLowerCase() ?? "",
    kapitelName,
    kapitelNameLower: kapitelName?.toLowerCase() ?? "",
  };
}

async function fetchTemplateIndexForCapture(prisma) {
  if (!prisma) return [];

  const records = await prisma.bereichKapitelTextTemplate.findMany({
    include: {
      kapitelTemplate: {
        include: {
          bauteilTemplate: true,
        },
      },
    },
  });

  return records.map(mapTemplateRecordForCapture).filter((entry) => entry.bauteilTemplateId && entry.text);
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

function normalizeOptions(result, options) {
  if (!options?.length) {
    return result;
  }
  if (!result.context) {
    return { ...result, context: { options } };
  }
  if (!Array.isArray(result.context.options) || !result.context.options.length) {
    return { ...result, context: { ...result.context, options } };
  }
  return result;
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

    return normalizeOptions({
      status: "awaiting_customer",
      message: lines.join("\n"),
      context: { options, phase: "select-customer" },
    }, options);
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

      const objektOptions = [
        ...objekte.map((objekt) => ({
          id: objekt.id,
          bezeichnung: objekt.bezeichnung,
          inputValue: objekt.bezeichnung,
        })),
        {
          id: "__create_object__",
          bezeichnung: "Neues Objekt anlegen",
          inputValue: "Neues Objekt anlegen",
          isCreateNew: true,
        },
      ];

      this.setConversation(chatId, {
        ...session,
        phase: "select-object",
        path: { kunde: path.kunde },
        options: objektOptions,
        pendingIntent,
      });

      return normalizeOptions({
        status: "awaiting_object",
        message: "Wähle das Objekt aus oder gib an, ob du ein neues Objekt erstellen möchtest.",
        context: { options: objektOptions, phase: "select-object" },
      }, objektOptions);
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
        // Send the human-friendly label instead of the numeric ID to avoid confusing user input like "13"
        inputValue: item.typ?.name ?? (item.id ? `Baurundgang ${item.id}` : "Baurundgang"),
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

      return normalizeOptions({
        status: "awaiting_baurundgang",
        message: `${intro} Bitte wähle einen Baurundgang über die Buttons oder gib die ID ein.`,
        context: { options: baurundgangOptions, phase: "select-baurundgang" },
      }, baurundgangOptions);
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

    if (session.phase?.startsWith("pruefpunkte:")) {
      if (intent) {
        if (intent === INTENTS.CAPTURE) {
          this.setConversation(chatId, { ...session, phase: "completed", options: null });
          return this.beginCaptureFlow({ chatId, session: { ...session, phase: "completed", path: currentPath }, initialNote: extractInitialNote(trimmed) });
        }
        return this.routeIntent({
          chatId,
          intent,
          message: trimmed,
          session,
          database,
        });
        return this.routeIntent({ chatId, intent, message: trimmed, session, database });
      }
      if (isCancelCommand(lower)) {
        this.setConversation(chatId, { ...session, phase: "completed", options: null });
        return { status: "pruefpunkte_cancelled", message: "Prüfpunkte-Erfassung beendet." };
      }
      if (isFinishCommand(lower)) {
        this.setConversation(chatId, { ...session, phase: "completed", options: null });
        return {
          status: "setup_complete",
          message: "Prüfpunkte-Erfassung abgeschlossen. Setup abgeschlossen. Du kannst jetzt Positionen erfassen (Foto/Notiz).",
          context: { selection: session.path },
        };
      }
      return this.continuePruefpunkteFlow({ chatId, session, message: trimmed });
    }

    if (session.phase?.startsWith("plan:")) {
      if (intent && intent !== INTENTS.PLAN) {
        return this.routeIntent({ chatId, intent, message: trimmed, session, database });
      }
      if (isCancelCommand(lower)) {
        this.setConversation(chatId, { ...session, phase: "completed", options: null, plan: null });
        return {
          status: "plan_cancelled",
          message: "Planung abgebrochen. Du kannst jederzeit wieder mit \"Planung\" oder \"AVOR\" fortfahren.",
          context: { selection: session.path },
        };
      }
      return this.continuePlanFlow({ chatId, session, message: trimmed, database });
    }

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

        if (intent === INTENTS.EDIT || intent === INTENTS.DELETE || intent === INTENTS.QUERY || intent === INTENTS.PLAN) {
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
        return normalizeOptions({
          status: "retry_customer",
          message: "Ich konnte den Kunden nicht zuordnen. Bitte wähle ihn über die Buttons oder gib den Namen ein.",
          context: { options: session.options, phase: session.phase },
        }, session.options);
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

      const objektOptions = [
        ...objekte.map((objekt) => ({
          id: objekt.id,
          bezeichnung: objekt.bezeichnung,
          inputValue: objekt.bezeichnung,
        })),
        {
          id: "__create_object__",
          bezeichnung: "Neues Objekt anlegen",
          inputValue: "Neues Objekt anlegen",
          isCreateNew: true,
        },
      ];

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
      if (selected?.isCreateNew || /^neues objekt/i.test(trimmed)) {
        return {
          status: "create_object_not_supported",
          message:
            "Das Anlegen neuer Objekte ist aktuell noch nicht direkt im QualiFlow Agent integriert. Bitte lege das Objekt zuerst im QS-Portal an und wähle es danach hier aus.",
        };
      }
      if (!selected) {
        return normalizeOptions({
          status: "retry_object",
          message: "Ich habe das Objekt nicht erkannt. Bitte wähle es über die Buttons oder gib den Namen ein.",
          context: { options: session.options, phase: session.phase },
        }, session.options);
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
        const nummer = item.typ?.nummer;
        const baseName = item.typ?.name ?? (item.id ? `Baurundgang ${item.id}` : "Baurundgang");
        const label = nummer ? `BR ${nummer} ${baseName}` : baseName;
        return {
          ...item,
          label,
          // Send the human-friendly label instead of the numeric ID to avoid confusing user input like "13"
          inputValue: label,
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

      // Avoid numeric index selection to prevent confusing random picks.
      // Prefer exact match by id, typ.nummer, label, or name.
      const opts = session.options ?? [];
      let selected = null;
      const num = /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
      if (num != null) {
        selected = opts.find((o) => o?.id === num || o?.typ?.nummer === num) ?? null;
      }
      if (!selected) {
        selected = findOptionByIdOrText(opts, trimmed.toLowerCase(), { labelKey: "label", valueKey: "id" });
      }

      if (!selected) {
        return normalizeOptions({
          status: "retry_baurundgang",
          message: "Ich konnte den Baurundgang nicht zuordnen. Bitte wähle ihn über die Buttons oder gib die ID ein.",
          context: { options: session.options, phase: session.phase },
        }, session.options);
      }

      const path = { ...session.path, baurundgang: selected };
      const baurundgangId = selected.id;
      const [qsReport, pruefpunkte, rueckmeldungSummary] = await Promise.all([
        database.actions.getQSReportByBaurundgang(baurundgangId),
        database.actions.listPruefpunkteByBaurundgang(baurundgangId),
        database.actions.summarizeRueckmeldungen({ baurundgangId }),
      ]);

      const statusLabel = formatStatusLabel(selected.status);
      let resolvedReport = qsReport ?? selected.qsReport ?? null;
      let downloadUrl = resolvedReport?.downloadUrl ?? null;

      if (resolvedReport?.id && !downloadUrl) {
        try {
          const generation = await this.handleTask({
            type: "report.generate",
            payload: { qsReportId: resolvedReport.id },
          });
          if (generation?.status === "SUCCESS") {
            downloadUrl = generation.downloadUrl ?? downloadUrl;
            resolvedReport = { ...resolvedReport, downloadUrl };
          }
        } catch (error) {
          this.logger.warn("Report konnte nicht neu generiert werden", {
            error: error?.message,
            qsReportId: resolvedReport.id,
          });
        }
      }

      const hasQsReport = Boolean(resolvedReport?.id);
      const positionsSummary = formatPositionsSummary(qsReport?.positionen ?? []);
      const pruefpunkteSummary = formatPruefpunkteSummary(pruefpunkte ?? []);
      const rueckSummary = formatRueckmeldungSummaryList(rueckmeldungSummary);

      const lines = [
        `Der Baurundgang ${selected.label ?? describeBaurundgang(selected)} ist aktuell ${statusLabel}.`,
        hasQsReport ? null : "Es liegt noch kein QS-Report vor.",
      ].filter(Boolean);

      if (positionsSummary.total) {
        lines.push(
          positionsSummary.total === 1
            ? "Es wurde bereits 1 Position erfasst:" 
            : `Es wurden bereits ${positionsSummary.total} Positionen erfasst:`,
        );
        lines.push(...withBullets(positionsSummary.lines));
      }

      if (pruefpunkteSummary.total) {
        lines.push(
          pruefpunkteSummary.total === 1
            ? "Es existiert 1 definierter Prüfpunkte-Hinweis:"
            : `Es existieren ${pruefpunkteSummary.total} definierte Prüfpunkte:`,
        );
        lines.push(...withBullets(pruefpunkteSummary.lines));
      }

      if (rueckSummary.length) {
        lines.push("Zusammenfassung nach Rückmeldungsarten:");
        lines.push(...withBullets(rueckSummary));
      }

      let followUpMessage = null;
      let status = "awaiting_pruefpunkte";
      let followUpContext = { phase: "pruefpunkte", selection: path };

      const listPruefpunkteOption = { id: "show-pruefpunkte", label: "Prüfpunkte anzeigen", inputValue: "Prüfpunkte anzeigen" };
      const prependDownloadOption = (options = []) =>
        downloadUrl
          ? [
              { id: "view-report", label: "Report ansehen", inputValue: downloadUrl, isLink: true },
              listPruefpunkteOption,
              ...options,
            ]
          : [listPruefpunkteOption, ...options];

      if (selected.status && selected.status.toLowerCase() === "abgeschlossen") {
        status = "baurundgang_abgeschlossen";
        followUpMessage = hasQsReport
          ? [
              "Der Baurundgang ist abgeschlossen und der QS-Report liegt vor.",
              downloadUrl ? `Report ansehen: ${downloadUrl}` : null,
              "Soll ich den Report anzeigen oder exportieren?",
            ]
              .filter(Boolean)
              .join("\n")
          : "Der Baurundgang ist abgeschlossen. Soll ich den QS-Report jetzt erstellen?";
        followUpContext = {
          ...followUpContext,
          qsReport: resolvedReport,
          options: prependDownloadOption(followUpContext.options ?? []),
        };
      } else if (hasQsReport) {
        followUpMessage = [
          downloadUrl ? `Report ansehen: ${downloadUrl}` : "Es existiert bereits ein QS-Report für diesen offenen Baurundgang.",
          "Sag mir einfach Bescheid, wenn du weitere Anpassungen brauchst.",
        ]
          .filter(Boolean)
          .join("\n");
        status = "qsreport_available";
        followUpContext = {
          ...followUpContext,
          phase: "completed",
          qsReport: resolvedReport,
          options: prependDownloadOption(followUpContext.options ?? []),
        };
      } else {
        followUpMessage = "Möchtest du Prüfpunkte erfassen? (ja/nein)";
        followUpContext = {
          ...followUpContext,
          options: prependDownloadOption(followUpContext.options ?? []),
        };
      }

      const message = [
        ...lines,
        "",
        followUpMessage,
      ]
        .filter(Boolean)
        .join("\n");

      const nextPhase = hasQsReport || status === "baurundgang_abgeschlossen" ? "completed" : "pruefpunkte";
      this.setConversation(chatId, {
        phase: nextPhase,
        path,
        options: nextPhase === "completed" ? null : session.options,
      });

      if (status === "baurundgang_abgeschlossen") {
        return {
          status,
          message,
          context: followUpContext,
        };
      }

      const resumed = await this.resumePendingIntentIfReady({ chatId, database });
      if (resumed) {
        return resumed;
      }

      return {
        status,
        message,
        context: followUpContext,
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
      if (choice) {
        return this.beginPruefpunkteFlow({ chatId, session: { ...session, path } });
      }

      this.setConversation(chatId, { phase: "completed", path });

      const resumed = await this.resumePendingIntentIfReady({ chatId, database });
      if (resumed) {
        return resumed;
      }

      return {
        status: "setup_complete",
        message: "Alles klar, wir überspringen die Prüfpunkte. Setup abgeschlossen. Du kannst jetzt Positionen erfassen (Foto/Notiz).",
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

        if (
          intent === INTENTS.START ||
          intent === INTENTS.EDIT ||
          intent === INTENTS.DELETE ||
          intent === INTENTS.QUERY ||
          intent === INTENTS.PLAN
        ) {
          return this.routeIntent({ chatId, intent, message: trimmed, session, database });
        }
      }

      return {
        status: "completed",
        message:
          "Setup ist bereits abgeschlossen. Du kannst z.B. weitere Positionen erfassen (z.B. \"Position erfassen\" oder ein Foto senden), " +
          "dir Rückmeldungen anzeigen lassen (z.B. \"Welche Rückmeldungen fallen an?\") oder den QS-Report ansehen (z.B. \"QS Report ansehen\"). " +
          "Was möchtest du als Nächstes tun?",
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
      case INTENTS.START:
        return this.handleStartIntent({ chatId, session, database });
      case INTENTS.QUERY:
        return this.handleQueryIntent({ chatId, message, session, database, skipEnsure });
      case INTENTS.PLAN:
        return this.handlePlanIntent({ chatId, message, session, database, skipEnsure });
      default:
        return {
          status: "unhandled_intent",
          message: "Ich konnte deine Eingabe nicht zuordnen.",
        };
    }
  }

  async handlePlanIntent({ chatId, message, session, database, skipEnsure = false }) {
    if (!database) {
      throw new Error("handlePlanIntent: database tool nicht verfügbar.");
    }

    if (!skipEnsure) {
      const ensured = await this.ensureSetupContext(chatId, {
        database,
        requireBaurundgang: false,
        intent: INTENTS.PLAN,
        originalMessage: message,
      });
      if (ensured) {
        return ensured;
      }
    }

    const lower = message.toLowerCase();
    const path = session.path ?? this.getConversation(chatId)?.path;

    if (!path?.objekt?.id) {
      return {
        status: "plan_missing_context",
        message: "Bitte wähle zuerst Kunde und Objekt aus, bevor wir die QS-Planung (AVOR) durchführen.",
      };
    }

    try {
      const objektId = path.objekt.id;

      let baurundgaenge = await database.actions.listBaurundgaengeByObjekt(objektId);
      let createdAuto = 0;
      if (!baurundgaenge?.length) {
        const autoCreate = await database.actions.autoCreateBaurundgaengeForObjekt(objektId);
        createdAuto = autoCreate?.created ?? 0;
        if (createdAuto > 0) {
          baurundgaenge = await database.actions.listBaurundgaengeByObjekt(objektId);
        }
      }

      if (!baurundgaenge?.length) {
        return {
          status: "plan_no_baurundgaenge",
          message:
            "Für dieses Objekt konnten keine Baurundgänge angelegt werden. Bitte prüfe die Stammdaten zu den Baurundgang-Typen.",
          context: { selection: path },
        };
      }

      const options = baurundgaenge.map((item) => {
        const nummer = item.typ?.nummer;
        const baseName = item.typ?.name ?? (item.id ? `Baurundgang ${item.id}` : "Baurundgang");
        const label = nummer ? `BR ${nummer} ${baseName}` : baseName;
        return {
          ...item,
          label,
          inputValue: label,
        };
      });

      const lines = options.map((option, index) => {
        const statusLabel = formatStatusLabel(option.status);
        const planned = option.datumGeplant ?? option.datumDurchgefuehrt ?? null;
        const dateLabel = planned ? new Date(planned).toISOString().slice(0, 10) : "kein Datum geplant";
        return `${index + 1}. ${option.label} – ${statusLabel}, geplant: ${dateLabel}`;
      });

      const header = composeSelectionSummary(path);
      const intro =
        /avor/.test(lower) || /planung/.test(lower)
          ? "Lass uns die QS-Planung (AVOR) für dieses Objekt durchgehen."
          : "Hier ist die aktuelle QS-Planung für dieses Objekt.";

      this.setConversation(chatId, {
        ...session,
        phase: "plan:select-baurundgang",
        path: { ...path },
        options,
        plan: { mode: "select-baurundgang" },
      });

      return {
        status: "plan_select_baurundgang",
        message: [
          header ? `Kontext: ${header}` : null,
          intro,
          createdAuto > 0
            ? `Ich habe automatisch ${createdAuto} Standard-Baurundgänge für dieses Objekt angelegt.`
            : null,
          "Folgende Baurundgänge sind vorgesehen:",
          ...lines,
          "\nWähle einen Baurundgang, dessen Datum du planen oder anpassen möchtest (Button oder Nummer).",
        ]
          .filter(Boolean)
          .join("\n"),
        context: { selection: path, options, phase: "plan:select-baurundgang" },
      };
    } catch (error) {
      this.logger.error("handlePlanIntent: Planung konnte nicht geladen werden", {
        error,
        objektId: path.objekt.id,
      });
      return {
        status: "plan_error",
        message: "Die QS-Planung konnte nicht geladen werden. Bitte versuche es erneut.",
      };
    }
  }

  async handleStartIntent({ chatId, session, database }) {
    if (!database) {
      throw new Error("handleStartIntent: database tool nicht verfügbar.");
    }

    const { path } = session;
    const baurundgangId = path?.baurundgang?.id;

    if (!baurundgangId) {
      return {
        status: "missing_baurundgang",
        message: "Es wurde noch kein Baurundgang ausgewählt. Bitte wähle zuerst einen Baurundgang.",
      };
    }

    try {
      // Update Baurundgang status to in_durchfuehrung
      await database.actions.updateBaurundgang({
        id: baurundgangId,
        status: "in_durchfuehrung",
        datumDurchgefuehrt: new Date(),
      });

      // Direkt in den Capture-Flow wechseln: Bauteil-Auswahl vorbereiten
      const templates = await database.actions.listBauteilTemplates();
      const options = (templates ?? []).map((template) => ({
        id: template.id,
        name: template.name ?? template.bezeichnung ?? template.kuerzel ?? `Bauteil ${template.id}`,
        inputValue: template.name ?? template.bezeichnung ?? template.kuerzel ?? `Bauteil ${template.id}`,
      }));

      const updatedPath = {
        ...path,
        baurundgang: {
          ...path.baurundgang,
          status: "in_durchfuehrung",
          datumDurchgefuehrt: new Date(),
        },
      };

      this.setConversation(chatId, {
        ...session,
        phase: "capture:select-bauteil",
        path: updatedPath,
        capture: { initialNote: "" },
        options,
      });

      const baurundgangLabel = describeBaurundgang(updatedPath.baurundgang);
      const summary = composeSelectionSummary(updatedPath);

      return {
        status: "baurundgang_started",
        message: [
          `✅ Baurundgang "${baurundgangLabel}" wurde gestartet!`,
          summary ? `Kontext: ${summary}` : null,
          "Lade ein Foto hoch und wähle das zugehörige Bauteil.",
          "Welches Bauteil möchtest du erfassen? Bitte nutze die Buttons oder gib den Namen ein.",
        ]
          .filter(Boolean)
          .join("\n"),
        context: { selection: updatedPath, phase: "capture:select-bauteil", options },
      };
    } catch (error) {
      this.logger.error("handleStartIntent: Fehler beim Starten des Baurundgangs", { error, baurundgangId });
      return {
        status: "start_error",
        message: "Beim Starten des Baurundgangs ist ein Fehler aufgetreten. Bitte versuche es erneut.",
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

  async continuePlanFlow({ chatId, session, message, database }) {
    if (!database) {
      throw new Error("continuePlanFlow: database tool nicht verfügbar.");
    }

    const trimmed = normalizeInput(message);
    const path = session.path ?? {};

    // Abbruch-Logik: User kann mit "abbrechen" den PLAN-Flow verlassen
    if (isCancelCommand(message)) {
      this.setConversation(chatId, {
        ...session,
        phase: "completed",
        plan: null,
        options: null,
      });
      return {
        status: STATUS_CODES.PLAN_CANCELLED,
        message: "Planung abgebrochen. Wie kann ich dir weiterhelfen?",
        context: { selection: session.path },
      };
    }

    if (session.phase === "plan:select-baurundgang") {
      const opts = session.options ?? [];
      let selected = null;

      if (/^\d+$/.test(trimmed)) {
        const index = Number.parseInt(trimmed, 10) - 1;
        if (index >= 0 && index < opts.length) {
          selected = opts[index];
        }
      }

      if (!selected) {
        selected = findOptionByIdOrText(opts, trimmed.toLowerCase(), { labelKey: "label", valueKey: "id" });
      }

      if (!selected) {
        return {
          status: "plan_retry_baurundgang",
          message:
            "Ich konnte den Baurundgang für die Planung nicht zuordnen. Bitte wähle einen der Buttons oder gib die Nummer ein.",
          context: { options: session.options, phase: session.phase },
        };
      }

      const newPath = { ...path, baurundgang: selected };
      this.setConversation(chatId, {
        ...session,
        phase: "plan:await-date",
        path: newPath,
        options: null,
        plan: { baurundgangId: selected.id },
      });

      const header = composeSelectionSummary(newPath);
      const planned = selected.datumGeplant ?? selected.datumDurchgefuehrt ?? null;
      const plannedLabel = planned ? new Date(planned).toISOString().slice(0, 10) : "kein Datum geplant";

      return {
        status: "plan_await_date",
        message: [
          header ? `Kontext: ${header}` : null,
          `Für ${describeBaurundgang(selected)} ist aktuell ${plannedLabel}.`,
          "Bitte gib das geplante Datum im Format JJJJ-MM-TT an oder schreibe \"heute\"/\"morgen\".",
        ]
          .filter(Boolean)
          .join("\n"),
        context: { selection: newPath, phase: "plan:await-date" },
      };
    }

    if (session.phase === "plan:await-date") {
      const value = normalizeInput(trimmed);
      if (!value) {
        return {
          status: "plan_retry_date",
          message: "Das Datum darf nicht leer sein. Bitte gib ein Datum im Format JJJJ-MM-TT an.",
        };
      }

      let targetDate;
      if (/^heute$/i.test(value)) {
        targetDate = new Date();
      } else if (/^morgen$/i.test(value)) {
        targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + 1);
      } else {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          return {
            status: "plan_retry_date",
            message:
              "Ich konnte das Datum nicht verstehen. Bitte gib es im Format JJJJ-MM-TT ein, z.B. 2024-05-10 oder schreibe \"heute\"/\"morgen\".",
          };
        }
        targetDate = parsed;
      }

      const planState = session.plan ?? {};
      const baurundgangId = planState.baurundgangId ?? session.path?.baurundgang?.id;
      if (!baurundgangId) {
        return {
          status: "plan_missing_baurundgang",
          message: "Es ist kein Baurundgang für die Planung ausgewählt. Bitte starte die Planung erneut.",
        };
      }

      try {
        await database.actions.updateBaurundgang({
          id: baurundgangId,
          status: "geplant",
          datumGeplant: targetDate,
        });

        const updatedPath = {
          ...path,
          baurundgang: {
            ...(path.baurundgang ?? {}),
            id: baurundgangId,
            status: "geplant",
            datumGeplant: targetDate,
          },
        };

        this.setConversation(chatId, {
          ...session,
          phase: "completed",
          path: updatedPath,
          plan: null,
          options: null,
        });

        const summary = composeSelectionSummary(updatedPath);
        const dateStr = targetDate.toISOString().slice(0, 10);

        return {
          status: "plan_success",
          message: [
            `Der Baurundgang ${describeBaurundgang(updatedPath.baurundgang)} wurde auf den ${dateStr} geplant.`,
            summary ? `Kontext: ${summary}` : null,
            "Wenn du weitere Baurundgänge planen möchtest, schreibe einfach \"Planung\" oder \"AVOR\".",
          ]
            .filter(Boolean)
            .join("\n"),
          context: { selection: updatedPath },
        };
      } catch (error) {
        this.logger.error("continuePlanFlow: Update des Baurundgangs fehlgeschlagen", {
          error,
          baurundgangId,
        });
        return {
          status: "plan_update_error",
          message: "Das geplante Datum konnte nicht gespeichert werden. Bitte versuche es erneut.",
        };
      }
    }

    return {
      status: "plan_unknown_state",
      message:
        "Ich konnte die Planung nicht fortsetzen. Bitte schreibe erneut \"Planung\" oder \"AVOR\", um den Planungs-Flow zu starten.",
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

    const lower = message.toLowerCase();
    const isReportOverviewQuery =
      (lower.includes("wo") || lower.includes("welche") || lower.includes("welcher") || lower.includes("welchen")) &&
      (lower.includes("qs report") || lower.includes("qs-report") || lower.includes("bericht") || lower.includes("report"));

    if (!skipEnsure) {
      const ensured = await this.ensureSetupContext(chatId, {
        database,
        requireBaurundgang: !isReportOverviewQuery,
        intent: INTENTS.QUERY,
        originalMessage: message,
      });
      if (ensured) {
        return ensured;
      }
    }

    const path = session.path ?? this.getConversation(chatId)?.path;

    if (isReportOverviewQuery) {
      if (!path?.objekt?.id) {
        return {
          status: "query_missing_context",
          message: "Bitte wähle zuerst Kunde und Objekt aus, bevor du nach vorhandenen QS-Reports fragst.",
        };
      }

      try {
        const reports = await database.actions.listQSReportsByObjekt(path.objekt.id);
        if (!reports?.length) {
          return {
            status: "query_qsreports_empty",
            message: "Für dieses Objekt liegen noch keine QS-Reports vor.",
            context: { selection: path },
          };
        }

        const lines = reports.map((report, index) => {
          const br = report.baurundgang ?? {};
          const nummer = br.typ?.nummer;
          const baseName = br.typ?.name ?? (br.id ? `Baurundgang ${br.id}` : `Baurundgang ${report.baurundgangId}`);
          const label = nummer ? `BR ${nummer} ${baseName}` : baseName;
          const datumRaw = br.datumDurchgefuehrt ?? br.datumGeplant ?? report.erstelltAm;
          const datum = datumRaw ? new Date(datumRaw).toISOString().slice(0, 10) : "kein Datum";
          return `${index + 1}. ${label} – QS-Report #${report.id} (erstellt am ${datum})`;
        });

        const header = composeSelectionSummary(path);
        return {
          status: "query_qsreports_overview",
          message: [
            header ? `Kontext: ${header}` : null,
            "Vorhandene QS-Reports für dieses Objekt:",
            ...lines,
          ]
            .filter(Boolean)
            .join("\n"),
          context: { selection: path },
        };
      } catch (error) {
        this.logger.error("handleQueryIntent: QS-Report-Übersicht fehlgeschlagen", {
          error,
          objektId: path.objekt.id,
        });
        return {
          status: "query_error",
          message: "Die QS-Reports konnten nicht geladen werden. Bitte versuche es erneut.",
        };
      }
    }

    if (!path?.baurundgang?.id) {
      return {
        status: "query_missing_context",
        message: "Bitte wähle zuerst Kunde, Objekt und Baurundgang aus, bevor du Auswertungen abfragst.",
      };
    }

    // Rueckmeldungsübersicht bevorzugt behandeln, auch wenn der Text gleichzeitig "Bericht" enthält
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

        const options = [
          {
            id: "view-report",
            label: "Report ansehen",
            inputValue: "Report anzeigen",
          },
          {
            id: "show-pruefpunkte",
            label: "Prüfpunkte anzeigen",
            inputValue: "Prüfpunkte anzeigen",
          },
          {
            id: "start-capture",
            label: "Neue Position erfassen",
            inputValue: "Position erfassen",
          },
        ];

        return {
          status: "query_rueckmeldungen",
          message: [header ? `Kontext: ${header}` : null, "Rückmeldungsübersicht:", ...items]
            .filter(Boolean)
            .join("\n"),
          context: { selection: path, options },
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

    // QS-Report anzeigen/erstellen/generieren
    if (/(bericht|report|qs[- ]?report|pdf|ansehen|exportieren|generier|erstell)/.test(lower)) {
      try {
        // Stelle sicher, dass ein QS-Report existiert
        const qsReport = await database.actions.ensureQsReportForBaurundgang({
          baurundgangId: path.baurundgang.id,
          kundeId: path?.kunde?.id,
          objektId: path?.objekt?.id,
        });

        // PDF erzeugen und Download-Link liefern
        const generation = await this.handleTask({
          type: "report.generate",
          payload: { qsReportId: qsReport.id },
        });

        if (generation?.status !== "SUCCESS") {
          return {
            status: "report_error",
            message: generation?.message || "Report konnte nicht generiert werden.",
            context: { selection: path },
          };
        }

        const url = generation.downloadUrl;
        const options = url
          ? [{ id: "view-report", label: "Report ansehen", inputValue: url, isLink: true }]
          : [];

        return {
          status: "report_generated",
          message: [
            "QS-Report erfolgreich generiert.",
            url ? `Report ansehen: ${url}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
          context: { selection: path, options },
        };
      } catch (error) {
        this.logger.error("handleQueryIntent: Report-Generierung fehlgeschlagen", {
          error,
          baurundgangId: path.baurundgang.id,
        });
        return {
          status: "report_error",
          message: "Der QS-Report konnte nicht generiert werden. Bitte versuche es erneut.",
          context: { selection: path },
        };
      }
    }

    if (lower.includes("prüfpunkt") || lower.includes("pruefpunkt") || lower.includes("checkliste")) {
      try {
        const pruefpunkte = await database.actions.listPruefpunkteByBaurundgang(path.baurundgang.id);
        const lines = [];
        let options = [];
        
        if (!pruefpunkte?.length) {
          lines.push("Es sind noch keine Prüfpunkte erfasst.");
          lines.push("Möchtest du Prüfpunkte erfassen?");
          options = [
            { id: "pp-start-yes", label: "Ja, Prüfpunkte erfassen", inputValue: "ja" },
            { id: "pp-start-no", label: "Nein, überspringen", inputValue: "nein" },
          ];
          this.setConversation(chatId, {
            ...session,
            phase: "pruefpunkte",
            path,
            options,
          });
          const header = composeSelectionSummary(path);
          return {
            status: "pruefpunkte_list_empty",
            message: [header ? `Kontext: ${header}` : null, ...lines].filter(Boolean).join("\n"),
            context: { selection: path, phase: "pruefpunkte", options },
          };
        } else {
          lines.push("Prüfpunkte:");
          for (const p of pruefpunkte) {
            const box = p.erledigt ? "[x]" : "[ ]";
            const note = p.notiz ? ` – ${truncateText(p.notiz, 60)}` : "";
            lines.push(`• ${box} #${p.id} ${p.bezeichnung}${note}`);
          }
          
          options = pruefpunkte.map((p) => ({
            id: `pp-${p.id}-${p.erledigt ? "unset" : "set"}`,
            label: p.erledigt ? `#${p.id} Unerledigt setzen` : `#${p.id} Erledigt setzen`,
            inputValue: `pp:toggle:${p.id}:${p.erledigt ? "false" : "true"}`,
          }));
          options.unshift({ id: "pp-refresh", label: "Aktualisieren", inputValue: "pp:refresh" });
        }

        this.setConversation(chatId, { ...session, phase: "pruefpunkte:list", options });

        const header = composeSelectionSummary(path);
        return {
          status: "pruefpunkte_list",
          message: [header ? `Kontext: ${header}` : null, ...lines].filter(Boolean).join("\n"),
          context: { selection: path, options, phase: "pruefpunkte:list" },
        };
      } catch (error) {
        this.logger.error("handleQueryIntent: Prüfpunkte-Abfrage fehlgeschlagen", { error, baurundgangId: path.baurundgang.id });
        return {
          status: "query_error",
          message: "Die Prüfpunkte konnten nicht geladen werden. Bitte versuche es erneut.",
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

    const trimmedNote = typeof initialNote === "string" ? initialNote.trim() : "";

    if (trimmedNote) {
      try {
        const prisma = database.actions.rawClient?.();
        const determineMatchOutcome = QsRundgangTest?.determineMatchOutcome;

        if (prisma && typeof determineMatchOutcome === "function") {
          const index = await fetchTemplateIndexForCapture(prisma);

          if (index?.length) {
            const decision = determineMatchOutcome(trimmedNote, index);

            if (decision?.outcome === "clear" && Array.isArray(decision.bestMatches) && decision.bestMatches.length) {
              const match = decision.bestMatches[0];
              const targetBauteilId = match.bauteilTemplateId ?? null;
              const targetBauteilNameLower =
                (match.bauteilNameLower ?? match.bauteilName?.toLowerCase?.() ?? "").trim();

              let bauteilTemplate = null;
              if (targetBauteilId != null) {
                bauteilTemplate = templates.find((tpl) => tpl.id === targetBauteilId) ?? null;
              }

              if (!bauteilTemplate && targetBauteilNameLower) {
                bauteilTemplate =
                  templates.find((tpl) => (tpl.name ?? "").toLowerCase() === targetBauteilNameLower) ?? null;
              }

              if (bauteilTemplate) {
                const kapitelTemplates = await database.actions.listKapitelTemplatesByBauteilTemplate(bauteilTemplate.id);
                let kapitelTemplate = null;

                if (Array.isArray(kapitelTemplates) && kapitelTemplates.length) {
                  const targetKapitelNameLower =
                    (match.kapitelNameLower ?? match.kapitelName?.toLowerCase?.() ?? "").trim();

                  if (targetKapitelNameLower) {
                    kapitelTemplate =
                      kapitelTemplates.find((tpl) => (tpl.name ?? "").toLowerCase() === targetKapitelNameLower) ??
                      null;
                  }

                  if (!kapitelTemplate) {
                    kapitelTemplate = kapitelTemplates[0];
                  }
                }

                if (kapitelTemplate) {
                  const autoSession = {
                    ...session,
                    capture: {
                      ...(session.capture ?? {}),
                      initialNote: trimmedNote,
                      bauteilTemplate,
                      kapitelTemplate,
                    },
                  };

                  return this.finalizeCapture({ chatId, session: autoSession, selectedRueckmeldungen: [] });
                }
              }
            }
          }
        }
      } catch (error) {
        this.logger?.warn?.("Auto-Suggest Capture fehlgeschlagen", { error: error?.message });
      }
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
        message: `Gewählt: ${selected.name}. Welches Bereichskapitel soll es sein? Bitte nutze die Buttons oder gib den Namen ein.`,
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

      let selectedIds = Array.isArray(capture?.rueckmeldungenSelected) ? capture.rueckmeldungenSelected : [];

      try {
        if ((!selectedIds || !selectedIds.length) && path?.baurundgang?.id && capture?.bauteilTemplate?.id && selected?.id) {
          const report = await database.actions.getQSReportByBaurundgang(path.baurundgang.id);
          const tmplKapitelName = selected.name?.toLowerCase?.();
          const match = report?.positionen?.find((p) =>
            p?.bauteil?.template?.id === capture.bauteilTemplate.id &&
            (p?.bereichKapitel?.name ?? "").toLowerCase() === (tmplKapitelName ?? "")
          );
          if (match) {
            const fromJoin = Array.isArray(match.rueckmeldungen)
              ? match.rueckmeldungen.map((r) => r?.rueckmeldungstyp?.id).filter(Boolean)
              : [];
            const fromSingle = match.rueckmeldungstyp?.id ? [match.rueckmeldungstyp.id] : [];
            selectedIds = Array.from(new Set([...(selectedIds ?? []), ...fromJoin, ...fromSingle])).filter(Boolean);
          }
        }
      } catch (e) {
        this.logger?.warn?.("Auto-Preselect Rueckmeldungen fehlgeschlagen", { error: e?.message });
      }

      const rueckOptions = [
        ...rueckmeldungstypen.map((typ) => ({
          id: typ.id,
          name: `${selectedIds.includes(typ.id) ? "✓ " : ""}${typ.name ?? typ.bezeichnung ?? `Rückmeldung ${typ.id}`}`,
          inputValue: `rm:toggle:${typ.id}`,
        })),
        { name: "Weiter", inputValue: "rm:weiter" },
      ];

      this.setConversation(chatId, {
        ...session,
        phase: "capture:select-rueckmeldung",
        options: rueckOptions,
        capture: {
          ...capture,
          kapitelTemplate: selected,
          rueckmeldungenSelected: selectedIds,
        },
      });

      return {
        status: "capture_select_rueckmeldung",
        message:
          `Gewählt: ${selected.name}. ` +
          "Du kannst 0–3 Rückmeldungen auswählen: Ausführungskontrolle Bauleitung, Abklärung durch Bauleitung, Rückmeldung an QualiCasa. Du kannst auch ohne Auswahl fortfahren.",
        context: { phase: "capture:select-rueckmeldung", options: rueckOptions },
      };
    }

    if (phase === "capture:select-rueckmeldung") {
      const trimmed = (message || "").trim().toLowerCase();
      const cap = session.capture ?? {};
      const current = Array.isArray(cap.rueckmeldungenSelected) ? [...cap.rueckmeldungenSelected] : [];

      if (trimmed === "rm:weiter" || trimmed === "weiter" || trimmed === "skip" || trimmed === "ohne" || trimmed === "ohne auswahl") {
        return this.finalizeCapture({ chatId, session, selectedRueckmeldungen: current });
      }

      const toggleMatch = trimmed.match(/^rm:toggle:(\d+)$/);
      let toggledId = toggleMatch ? Number.parseInt(toggleMatch[1], 10) : null;

      if (!toggledId) {
        // Allow toggling by clicking the label (resolve by name)
        const picked = resolveSelection(message, options, { labelKey: "name" });
        if (picked?.id) {
          toggledId = picked.id;
        }
      }

      if (!toggledId) {
        return {
          status: "capture_retry_rueckmeldung",
          message:
            "Nicht erkannt. Nutze die Buttons, um Rückmeldungen zu toggeln, oder tippe 'Weiter' um fortzufahren.",
          context: { options, phase, capture: { ...cap, rueckmeldungenSelected: current } },
        };
      }

      const idx = current.indexOf(toggledId);
      if (idx >= 0) current.splice(idx, 1);
      else if (current.length < 3) current.push(toggledId);

      const allTypes = await database.actions.listRueckmeldungstypen();
      const updatedOptions = [
        ...allTypes.map((typ) => ({
          id: typ.id,
          name: `${current.includes(typ.id) ? "✓ " : ""}${typ.name ?? typ.bezeichnung ?? `Rückmeldung ${typ.id}`}`,
          inputValue: `rm:toggle:${typ.id}`,
        })),
        { name: "Weiter", inputValue: "rm:weiter" },
      ];

      this.setConversation(chatId, {
        ...session,
        phase: "capture:select-rueckmeldung",
        options: updatedOptions,
        capture: { ...cap, rueckmeldungenSelected: current },
      });

      const selectedNames = allTypes
        .filter((t) => current.includes(t.id))
        .map((t) => t.name)
        .join(", ");

      return {
        status: "capture_select_rueckmeldung",
        message:
          (selectedNames ? `Ausgewählt: ${selectedNames}. ` : "") +
          "Du kannst 0–3 Rückmeldungen auswählen: Ausführungskontrolle Bauleitung, Abklärung durch Bauleitung, Rückmeldung an QualiCasa. Tippe 'Weiter' zum Fortfahren.",
        context: { phase: "capture:select-rueckmeldung", options: updatedOptions },
      };
    }

    if (phase === "capture:confirm") {
      const choice = parseYesNo(message);
      if (choice == null) {
        return {
          status: "capture_retry_confirm",
          message: 'Bitte antworte mit ja oder nein, z.B. "ja".',
          context: { phase, options: session.options ?? [] },
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

  async beginPruefpunkteFlow({ chatId, session }) {
    const database = this.tools?.database;
    if (!database) {
      throw new Error("beginPruefpunkteFlow: database tool nicht verfügbar.");
    }

    const { path } = session;
    if (!path?.baurundgang?.id) {
      return {
        status: "missing_setup",
        message: "Bitte schließe zuerst den Setup-Flow mit Kunde, Objekt und Baurundgang ab.",
      };
    }

    this.setConversation(chatId, {
      ...session,
      phase: "pruefpunkte:enter-title",
      options: null,
      pruefpunkteCapture: null,
    });

    return {
      status: "pruefpunkte_enter_title",
      message: "Bitte gib den Prüfpunkttitel ein (z.B. 'Fluchtweg beschildert'). Tippe 'fertig' zum Beenden.",
      context: { phase: "pruefpunkte:enter-title" },
    };
  }

  async continuePruefpunkteFlow({ chatId, session, message }) {
    const database = this.tools?.database;
    if (!database) {
      throw new Error("continuePruefpunkteFlow: database tool nicht verfügbar.");
    }

    const { phase, path } = session;
    if (phase === "pruefpunkte:list") {
      const lower = message.toLowerCase();
      if (lower === "pp:refresh" || lower === "aktualisieren") {
        // re-list
        return this.handleQueryIntent({ chatId, message: "prüfpunkte anzeigen", session, database: this.tools.database, skipEnsure: true });
      }

      const match = lower.match(/pp:toggle:(\d+):(true|false)/);
      if (!match) {
        return {
          status: "pruefpunkte_list_hint",
          message: "Bitte nutze die Buttons, um Prüfpunkte auf erledigt/unerledigt zu setzen, oder tippe 'fertig' zum Beenden.",
          context: { phase, options: session.options },
        };
      }

      const id = Number.parseInt(match[1], 10);
      const flag = match[2] === "true";
      try {
        await this.tools.database.actions.setPruefpunktErledigt({ id, erledigt: flag });
        // re-list after toggle
        return this.handleQueryIntent({ chatId, message: "prüfpunkte anzeigen", session, database: this.tools.database, skipEnsure: true });
      } catch (error) {
        this.logger.error("continuePruefpunkteFlow: Toggle fehlgeschlagen", { error, id, flag });
        return {
          status: "pruefpunkte_toggle_error",
          message: "Status konnte nicht geändert werden. Bitte versuche es erneut.",
        };
      }
    }
    if (phase === "pruefpunkte:enter-title") {
      const title = message?.trim();
      if (!title) {
        return {
          status: "pruefpunkte_retry_title",
          message: "Bitte gib einen Titel für den Prüffpunkt ein (z.B. 'Fluchtweg beschildert').",
          context: { phase },
        };
      }

      this.setConversation(chatId, {
        ...session,
        phase: "pruefpunkte:enter-note",
        pruefpunkteCapture: { title },
      });

      return {
        status: "pruefpunkte_enter_note",
        message: "Optional: Notiz eingeben und senden. Oder tippe 'weiter' um ohne Notiz zu speichern.",
        context: { phase: "pruefpunkte:enter-note" },
      };
    }

    if (phase === "pruefpunkte:enter-note") {
      const capture = session.pruefpunkteCapture ?? {};
      const title = capture.title?.trim();
      if (!title) {
        // Fallback: zurück zum Titel
        this.setConversation(chatId, { ...session, phase: "pruefpunkte:enter-title", pruefpunkteCapture: null });
        return {
          status: "pruefpunkte_retry_title",
          message: "Bitte gib einen Titel für den Prüffpunkt ein.",
          context: { phase: "pruefpunkte:enter-title" },
        };
      }

      const normalized = message?.trim().toLowerCase();
      const noNote = normalized === "weiter" || normalized === "skip" || normalized === "ohne notiz";

      const created = await database.actions.createPruefpunkt({
        baurundgangId: session.path?.baurundgang?.id,
        bezeichnung: title,
        notiz: noNote ? undefined : message?.trim(),
      });

      this.setConversation(chatId, {
        ...session,
        phase: "pruefpunkte:enter-title",
        pruefpunkteCapture: null,
        options: null,
        pruefpunkte: { count: (session.pruefpunkte?.count ?? 0) + 1 },
      });

      return {
        status: "pruefpunkte_saved",
        message: `Prüfpunkt gespeichert (#${created.id}): ${title}. Nächster Prüffpunkt? Gib den Titel ein oder tippe 'fertig' zum Beenden.`,
        context: { phase: "pruefpunkte:enter-title", createdPruefpunkt: created },
      };
    }

    return {
      status: "pruefpunkte_unknown_state",
      message: "Ich konnte deine Eingabe nicht verarbeiten. Tippe 'fertig' zum Beenden oder versuche es erneut.",
    };
  }

  async finalizeCapture({ chatId, session, selectedRueckmeldungen }) {
    const cap = session.capture ?? {};
    const chosenIds = Array.isArray(selectedRueckmeldungen)
      ? selectedRueckmeldungen
      : Array.isArray(cap.rueckmeldungenSelected)
      ? cap.rueckmeldungenSelected
      : [];

    const updatedCapture = { ...cap, rueckmeldungenSelected: chosenIds };
    const confirmOptions = [
      { id: "capture-confirm-yes", label: "Ja, Position anlegen", inputValue: "ja" },
      { id: "capture-confirm-no", label: "Nein, abbrechen", inputValue: "nein" },
    ];

    this.setConversation(chatId, {
      ...session,
      phase: "capture:confirm",
      capture: updatedCapture,
      options: confirmOptions,
    });

    // Resolve names for summary
    let rmSummaryNames = [];
    try {
      const allTypes = await this.tools?.database?.actions?.listRueckmeldungstypen?.();
      if (Array.isArray(allTypes)) {
        const byId = new Map(allTypes.map((t) => [t.id, t.name]));
        rmSummaryNames = chosenIds.map((id) => byId.get(id)).filter(Boolean);
      }
    } catch (_) {}

    const summary = [
      "Bitte bestätige die Angaben:",
      `Bauteil: ${updatedCapture.bauteilTemplate?.name ?? "?"}`,
      `Bereichskapitel: ${updatedCapture.kapitelTemplate?.name ?? "?"}`,
      `Rückmeldung(en): ${rmSummaryNames.length ? rmSummaryNames.join(", ") : "-"}`,
      updatedCapture.initialNote ? `Hinweis: ${updatedCapture.initialNote}` : null,
    ].filter(Boolean);

    return {
      status: "capture_confirm",
      message: [...summary, "Soll die Position angelegt werden? (ja/nein)"].join("\n"),
      context: { phase: "capture:confirm", capture: updatedCapture, options: confirmOptions },
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

    if (!capture?.bauteilTemplate?.id || !capture?.kapitelTemplate?.id) {
      return {
        status: "capture_missing_selection",
        message: "Für die Positionserfassung müssen Bauteil und Bereichskapitel gesetzt sein. Bitte starte den Capture-Flow erneut.",
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

    const selectedRmIds = Array.isArray(capture?.rueckmeldungenSelected) ? capture.rueckmeldungenSelected : [];
    const payload = {
      baurundgangId,
      qsreportId: qsReport.id,
      bauteilTemplateId: capture?.bauteilTemplate?.id,
      kapitelTemplateId: capture?.kapitelTemplate?.id,
      rueckmeldungstypId: selectedRmIds.length === 1 ? selectedRmIds[0] : undefined,
      rueckmeldungstypIds: selectedRmIds.length ? selectedRmIds : undefined,
      bemerkung: capture?.initialNote || "",
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
