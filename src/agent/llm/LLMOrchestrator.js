import { createLogger } from "../../utils/logger.js";
import { getOpenAI, getOpenAIModel } from "./openaiClient.js";
import { buildSystemPrompt } from "./qualiflowPrompt.js";

function safeParse(json) {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

export class LLMOrchestrator {
  constructor({ tools = {}, sessionOptions = {} } = {}) {
    this.tools = tools;
    this.logger = createLogger("agent:llm-orchestrator");
    this.sessionOptions = { maxHistory: sessionOptions.maxHistory ?? 40 };
    this.stateByChat = new Map();
  }

  getState(chatId) {
    if (!chatId) return null;
    let s = this.stateByChat.get(chatId);
    if (!s) {
      s = { context: {}, history: [] };
      this.stateByChat.set(chatId, s);
    }
    return s;
  }

  setContext(chatId, patch = {}) {
    const s = this.getState(chatId);
    s.context = { ...(s.context ?? {}), ...(patch ?? {}) };
    return s.context;
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
      list_kunden: async () => db.actions.listKunden(),
      list_objekte: async ({ kundeId }) => db.actions.listObjekteByKunde(kundeId),
      list_baurundgaenge: async ({ objektId }) => db.actions.listBaurundgaengeByObjekt(objektId),
      auto_create_baurundgaenge_for_objekt: async ({ objektId }) =>
        db.actions.autoCreateBaurundgaengeForObjekt(objektId),
      find_kunde_by_name: async ({ name }) => db.actions.findKundeByName(name),
      find_objekt_by_name: async ({ name, kundeId }) => db.actions.findObjektByName({ name, kundeId }),
      create_kunde: async ({ name, adresse, plz, ort }) => db.actions.ensureKunde({ name, adresse, plz, ort }),
      create_objekt: async (payload) => db.actions.createObjektForKunde(payload),
      create_baurundgang: async (payload) => db.actions.createBaurundgang(payload),
      list_rueckmeldungstypen: async () => db.actions.listRueckmeldungstypen(),
      summarize_rueckmeldungen: async ({ baurundgangId }) => db.actions.summarizeRueckmeldungen({ baurundgangId }),
      ensure_qs_report_for_baurundgang: async (payload) => db.actions.ensureQsReportForBaurundgang(payload),
      create_position_with_defaults: async (payload) => db.actions.createPositionWithDefaults(payload),
      update_kunde_fields: async ({ id, data }) => db.actions.updateKundeFields({ id, data }),
      update_objekt_fields: async ({ id, data }) => db.actions.updateObjektFields({ id, data }),
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
    const client = getOpenAI();
    const model = getOpenAIModel();

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
