export class MockChatOrchestrator {
  constructor() {
    this.sessions = new Map();
  }

  getSession(chatId) {
    if (!this.sessions.has(chatId)) {
      this.sessions.set(chatId, {
        resolvedProjektleiter: false,
      });
    }
    return this.sessions.get(chatId);
  }

  buildPendingContext() {
    return {
      pendingRequirements: {
        missingMandatory: ["projektleiter"],
        pendingFields: [{ field: "projektleiter", message: "Bitte Projektleiter angeben." }],
      },
    };
  }

  beginConversation(chatId) {
    const session = this.getSession(chatId);
    session.resolvedProjektleiter = false;
    return {
      status: "info",
      message: "Willkommen! Bitte gib den Projektleiter an (z. B. 'Projektleiter: Max Beispiel').",
      context: this.buildPendingContext(),
    };
  }

  handleMessage({ chatId, message }) {
    const session = this.getSession(chatId);
    const normalized = message?.trim() ?? "";

    if (!normalized) {
      return this.beginConversation(chatId);
    }

    if (/projektleiter\s*[:\-]/i.test(normalized)) {
      session.resolvedProjektleiter = true;
      return {
        status: "created",
        message: "Danke! Projektleiter wurde erfasst.",
        context: {
          projektleiter: {
            name: normalized.split(/[:\-]/, 2)[1]?.trim() || "Projektleiter",
          },
          pendingRequirements: null,
        },
      };
    }

    return {
      status: "needs_input",
      message: "Ich habe den Projektleiter noch nicht erkannt. Bitte verwende das Format 'Projektleiter: Name'.",
      context: this.buildPendingContext(),
    };
  }
}
