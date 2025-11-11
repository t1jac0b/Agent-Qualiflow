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

function resolveSelection(input, options, { labelKey = "name", valueKey = "id" } = {}) {
  if (!options?.length) return null;
  const normalized = input.toLowerCase();

  const numericIndex = isNumericSelection(input, options.length);
  if (numericIndex != null) {
    return options[numericIndex];
  }

  const byId = options.find((option) => String(option[valueKey]).toLowerCase() === normalized);
  if (byId) return byId;

  return options.find((option) => option[labelKey]?.toLowerCase?.() === normalized) ?? null;
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

export class AgentOrchestrator {
  constructor({ tools = {}, logger = createLogger("agent:orchestrator") } = {}) {
    this.tools = tools;
    this.capabilities = new Map();
    this.subAgents = new Map();
    this.logger = logger;
    this.conversations = new Map();
    this.logger.info("AgentOrchestrator initialisiert", {
      toolKeys: Object.keys(tools),
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

    if (lower === "start") {
      const kunden = await database.actions.listKunden();
      if (!kunden?.length) {
        this.setConversation(chatId, { phase: "idle", path: {} });
        return {
          status: "no_customers",
          message: "Es wurden keine Kunden gefunden. Bitte lege zuerst Daten an.",
        };
      }

      this.setConversation(chatId, {
        phase: "select-customer",
        path: {},
        options: kunden,
      });

      const list = describeOptions(kunden, { labelKey: "name" });
      return {
        status: "awaiting_customer",
        message: [`Welcher Kunde?`, list].join("\n"),
        context: { options: kunden, phase: "select-customer" },
      };
    }

    if (session.phase === "idle") {
      return {
        status: "hint",
        message: "Tippe \"start\", um den Setup-Flow zu beginnen.",
      };
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

    return {
      status: "unknown_state",
      message: "Ich konnte deine Eingabe nicht verarbeiten. Tippe \"start\", um den Setup-Flow neu zu beginnen.",
    };
  }
}
