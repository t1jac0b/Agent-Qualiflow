import path from "node:path";

import JSZip from "jszip";

import { createLogger } from "../../utils/logger.js";
import { createToolInvoker } from "../tools/toolTypes.js";

const NOTE_FILENAME_REGEX = /notizen?\.txt$/i;
const IMAGE_FILENAME_REGEX = /\.(?:png|jpe?g|webp|heic)$/i;

const KEYWORD_RULES = [
  { pattern: /xps\s*d[äa]mmung/i, bauteil: "Rohbau", label: "XPS Dämmung" },
  { pattern: /abdichtung/i, bauteil: "Rohbau", label: "Abdichtung" },
  { pattern: /beton/i, bauteil: "Rohbau", label: "Beton" },
];

function classifyNotes(notesText = "") {
  const normalized = notesText.trim();
  if (!normalized) {
    return { keyword: null, bauteilName: null, label: null };
  }

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(normalized)) {
      return { keyword: rule.pattern.source, bauteilName: rule.bauteil, label: rule.label };
    }
  }

  return { keyword: null, bauteilName: "Rohbau", label: null };
}

async function pickTemplateForBauteil(prisma, bauteilName) {
  if (!bauteilName) return null;

  return prisma.bereichKapitelTextTemplate.findFirst({
    where: {
      kapitelTemplate: {
        bereichTemplate: {
          bauteilTemplate: {
            name: { equals: bauteilName, mode: "insensitive" },
          },
        },
      },
    },
    include: {
      kapitelTemplate: {
        include: {
          bereichTemplate: {
            include: {
              bauteilTemplate: true,
            },
          },
        },
      },
    },
  });
}

async function ensureReportDraft(prisma, { kundeId, objektId, baurundgangId }) {
  let qsReport = await prisma.qSReport.findUnique({ where: { baurundgangId } });
  if (qsReport) return qsReport;

  return prisma.qSReport.create({
    data: {
      baurundgang: { connect: { id: baurundgangId } },
      objekt: { connect: { id: objektId } },
      kunde: { connect: { id: kundeId } },
      zusammenfassung: "Automatisch angelegter QS-Report (Stub)",
    },
  });
}

async function ensurePosition(prisma, { qsReportId, baurundgangId, bauteilName, bemerkung }) {
  const existingCount = await prisma.position.count({ where: { qsreportId: qsReportId } });

  let bauteil = null;
  if (bauteilName) {
    bauteil = await prisma.bauteil.findFirst({
      where: {
        baurundgangId,
        template: {
          name: { equals: bauteilName, mode: "insensitive" },
        },
      },
    });
  }

  return prisma.position.create({
    data: {
      qsreportId: qsReportId,
      positionsnummer: existingCount + 1,
      bauteilId: bauteil?.id ?? null,
      bemerkung,
      bereichstitel: bauteilName ?? undefined,
    },
  });
}

export class QsRundgangAgent {
  constructor({ tools = {}, logger = createLogger("agent:qsRundgang") } = {}) {
    this.logger = logger;
    this.tools = {};
    this.fileInvoker = null;
    this.databaseInvoker = null;
    this.setTools(tools);
  }

  setTools(tools = {}) {
    this.tools = tools;
    this.fileInvoker = tools?.file ? createToolInvoker(tools.file) : null;
    this.databaseInvoker = tools?.database ? createToolInvoker(tools.database) : null;
  }

  getCapabilities() {
    return {
      "qsRundgang.upload": (payload) => this.handleUpload(payload),
    };
  }

  async handleUpload({
    buffer,
    filePath,
    originalFilename,
    uploadedBy = "qs-mobile",
    kundeId,
    objektId,
    baurundgangId,
    notesText,
    photos,
  }) {
    if (!this.fileInvoker || !this.databaseInvoker) {
      throw new Error("QsRundgangAgent: Tools sind nicht initialisiert.");
    }

    const missing = [];
    if (!kundeId) missing.push("kundeId");
    if (!objektId) missing.push("objektId");
    if (!baurundgangId) missing.push("baurundgangId");
    if (missing.length) {
      return {
        status: "needs_input",
        message: `Folgende Felder werden benötigt: ${missing.join(", ")}`,
        context: { missing },
      };
    }

    const prisma = this.databaseInvoker("rawClient");

    let storedArchive = null;
    let processed = { notes: notesText ?? "", photos: [] };

    if (buffer || filePath) {
      const archiveBuffer = await this.fileInvoker("resolveBuffer", { buffer, filePath });

      storedArchive = await this.fileInvoker("storeUpload", {
        buffer: archiveBuffer,
        originalFilename: originalFilename ?? "qs-rundgang.zip",
        bucket: "qs-rundgang/raw",
      });

      try {
        processed = await this.extractPayloadFromArchive(
          archiveBuffer,
          path.basename(originalFilename ?? storedArchive.storedFilename),
        );
      } catch (error) {
        this.logger.error("Archiv konnte nicht verarbeitet werden", { error: error.message });
        return {
          status: "error",
          message: "Die hochgeladene Datei konnte nicht gelesen werden.",
          context: { storedArchive },
        };
      }
    } else if (Array.isArray(photos) && photos.length) {
      for (const photo of photos) {
        if (!photo?.buffer) continue;
        const stored = await this.fileInvoker("storeUpload", {
          buffer: photo.buffer,
          originalFilename: photo.originalFilename ?? "foto.jpg",
          bucket: "qs-rundgang/photos",
        });
        processed.photos.push({ originalName: photo.originalFilename ?? "foto", storedPath: stored.storedPath });
      }
    }

    if (!processed?.notes?.trim()) {
      return {
        status: "needs_input",
        message: "Keine notizen.txt im Upload gefunden.",
        context: { storedArchive },
      };
    }

    const classification = classifyNotes(processed.notes);
    if (!classification.bauteilName) {
      return {
        status: "needs_input",
        message: "Die Notizen konnten keinem Bauteil zugeordnet werden.",
        context: { storedArchive },
      };
    }

    const template = await pickTemplateForBauteil(prisma, classification.bauteilName);

    const report = await ensureReportDraft(prisma, { kundeId, objektId, baurundgangId });

    const bemerkung = template
      ? `Automatischer Mangelstub (${classification.label ?? classification.bauteilName}): ${template.text}`
      : `Automatischer Mangelstub (${classification.label ?? classification.bauteilName}).`;

    const position = await ensurePosition(prisma, {
      qsReportId: report.id,
      baurundgangId,
      bauteilName: classification.bauteilName,
      bemerkung,
    });

    return {
      status: "success",
      message: "QS-Rundgang-Daten verarbeitet (Stub)",
      context: {
        storedArchive,
        photos: processed.photos,
        classification,
        templateId: template?.id ?? null,
        reportId: report.id,
        positionId: position.id,
        uploadedBy,
      },
    };
  }

  async extractPayloadFromArchive(buffer, fallbackName = "upload.zip") {
    const zip = await JSZip.loadAsync(buffer);
    const photos = [];
    let notes = "";

    const entries = Object.values(zip.files);
    for (const entry of entries) {
      if (entry.dir) continue;
      const entryName = entry.name;

      if (NOTE_FILENAME_REGEX.test(entryName)) {
        notes = await entry.async("string");
        continue;
      }

      if (IMAGE_FILENAME_REGEX.test(entryName)) {
        const photoBuffer = await entry.async("nodebuffer");
        const stored = await this.fileInvoker("storeUpload", {
          buffer: photoBuffer,
          originalFilename: path.basename(entryName),
          bucket: "qs-rundgang/photos",
        });
        photos.push({ originalName: entryName, storedPath: stored.storedPath });
      }
    }

    if (!notes && zip.file(/notizen/i)?.length) {
      const firstMatch = zip.file(/notizen/i)[0];
      notes = await firstMatch.async("string");
    }

    if (!notes) {
      this.logger.warn("Keine Notizen im Archiv gefunden", { fallbackName });
    }

    return { notes, photos };
  }
}

export const __test__ = { classifyNotes };
