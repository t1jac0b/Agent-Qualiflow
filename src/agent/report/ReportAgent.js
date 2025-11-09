import { processBauBeschriebUpload, finalizeBauBeschrieb } from "../bauBeschrieb/processBauBeschrieb.js";

export class ReportAgent {
  constructor({ tools = {} } = {}) {
    this.tools = tools;
  }

  setTools(tools) {
    this.tools = tools;
  }

  getCapabilities() {
    return {
      "bauBeschrieb.upload": (payload) => this.handleBauBeschriebUpload(payload),
      "bauBeschrieb.finalize": (payload) => this.handleFinalizeBauBeschrieb(payload),
    };
  }

  async handleBauBeschriebUpload({ buffer, filePath, originalFilename, uploadedBy }) {
    return processBauBeschriebUpload({ buffer, filePath, originalFilename, uploadedBy });
  }

  async handleFinalizeBauBeschrieb({ ingestion, extracted, overrides }) {
    return finalizeBauBeschrieb({ ingestion, extracted, overrides });
  }
}
