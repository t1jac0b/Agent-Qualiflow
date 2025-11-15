import { promises as fs } from "node:fs";
import path from "node:path";

import { processBauBeschriebUpload, finalizeBauBeschrieb } from "../bauBeschrieb/processBauBeschrieb.js";
import { renderHtml } from "../../render/ReportHtmlRenderer.js";

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
      "report.generate": (payload) => this.handleReportGenerate(payload),
    };
  }

  async handleBauBeschriebUpload({ buffer, filePath, originalFilename, uploadedBy }) {
    return processBauBeschriebUpload({ buffer, filePath, originalFilename, uploadedBy });
  }

  async handleFinalizeBauBeschrieb({ ingestion, extracted, overrides }) {
    return finalizeBauBeschrieb({ ingestion, extracted, overrides });
  }

  async handleReportGenerate({ qsReportId, baurundgangId, outputDir }) {
    try {
      if (!this.tools?.database) {
        throw new Error("ReportAgent: database tool ist nicht verfügbar.");
      }

      const database = this.tools.database;
      const getReport = qsReportId
        ? () => database.actions.getQSReport(qsReportId)
        : () => database.actions.getQSReportByBaurundgang(baurundgangId);

      const report = await getReport();
      if (!report) {
        const identifier = qsReportId ? `QS-Report ${qsReportId}` : `Baurundgang ${baurundgangId}`;
        throw new Error(`ReportAgent: Datensatz für ${identifier} wurde nicht gefunden.`);
      }

      const html = renderHtml(report);

      const targetDir = outputDir ?? path.join(process.cwd(), "storage", "reports", "qs");
      await fs.mkdir(targetDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeReportId = String(report.id ?? "qs-report").padStart(4, "0");
      const filename = `qs-report-${safeReportId}-${timestamp}.pdf`;
      const pdfPath = path.join(targetDir, filename);

      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      const page = await browser.newPage();

      try {
        await page.setContent(html, { waitUntil: "networkidle" });
        await page.pdf({
          path: pdfPath,
          format: "A4",
          margin: { top: "0", right: "0", bottom: "0", left: "0" },
          printBackground: true,
        });
      } finally {
        await browser.close();
      }

      const relativePath = path.relative(process.cwd(), pdfPath);
      const downloadUrl = `/${relativePath.replace(/\\+/g, "/")}`;

      return {
        status: "SUCCESS",
        message: "QS-Report erfolgreich generiert.",
        pdfPath,
        reportId: report.id,
        downloadUrl,
      };
    } catch (error) {
      console.error("[ReportAgent] handleReportGenerate failed", {
        message: error?.message,
        stack: error?.stack,
        qsReportId,
        baurundgangId,
      });
      throw error;
    }
  }
}
