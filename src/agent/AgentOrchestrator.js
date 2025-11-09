import { createLogger } from "../utils/logger.js";

export class AgentOrchestrator {
  constructor({ tools = {}, logger = createLogger("agent:orchestrator") } = {}) {
    this.tools = tools;
    this.capabilities = new Map();
    this.subAgents = new Map();
    this.logger = logger;
    this.logger.info("AgentOrchestrator initialisiert", {
      toolKeys: Object.keys(tools),
    });
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
}
