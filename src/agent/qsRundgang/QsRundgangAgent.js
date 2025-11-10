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

function extractKeywords(notesText = "") {
  return Array.from(
    new Set((notesText.toLowerCase().match(/[a-z0-9äöüß]{3,}/gi) ?? []).map((token) => token.trim())),
  );
}

function formatOptionsMessage(options = []) {
  if (!options.length) {
    return "Ich bin unsicher. Kannst du das betroffene Bauteil genauer benennen?";
  }
  if (options.length === 1) {
    return `Ich bin unsicher. Meinst du '${options[0]}'?`;
  }
  const quoted = options.map((option) => `'${option}'`);
  const last = quoted.pop();
  return `Ich bin unsicher. Meinst du ${quoted.join(", ")} oder ${last}?`;
}

function rankTemplateMatches(notesText = "", templates = []) {
  const normalizedNote = notesText.toLowerCase();
  const keywords = extractKeywords(normalizedNote);
  const ruleMatches = KEYWORD_RULES.filter((rule) => rule.pattern.test(normalizedNote));

  const matches = [];

  for (const template of templates) {
    const textLower = template.textLower ?? template.text.toLowerCase();
    const bauteilLower = template.bauteilNameLower ?? template.bauteilName?.toLowerCase() ?? "";
    const bereichLower = template.bereichNameLower ?? template.bereichName?.toLowerCase() ?? "";
    const kapitelLower = template.kapitelNameLower ?? template.kapitelName?.toLowerCase() ?? "";

    let score = 0;
    for (const keyword of keywords) {
      if (!keyword) continue;
      if (textLower.includes(keyword)) score += 2;
      if (bauteilLower.includes(keyword)) score += 1;
      if (bereichLower.includes(keyword)) score += 0.5;
      if (kapitelLower.includes(keyword)) score += 0.5;
    }

    for (const rule of ruleMatches) {
      if (rule.bauteil && bauteilLower.includes(rule.bauteil.toLowerCase())) {
        score += 3;
      }
      if (rule.label && textLower.includes(rule.label.toLowerCase())) {
        score += 2;
      }
    }

    if (score > 0) {
      matches.push({ ...template, score });
    }
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.id ?? 0) - (b.id ?? 0);
  });

  return { keywords, matches, ruleMatches };
}

function determineMatchOutcome(notesText = "", templates = []) {
  const ranking = rankTemplateMatches(notesText, templates);
  if (ranking.matches.length === 0) {
    return { ...ranking, outcome: "none", bestMatches: [] };
  }

  const bestScore = ranking.matches[0].score;
  const bestMatches = ranking.matches.filter((match) => match.score === bestScore);
  const outcome = bestMatches.length === 1 ? "clear" : "ambiguous";

  return { ...ranking, bestMatches, outcome };
}

function computeFristDate(baurundgang, fallbackDays = 7) {
  if (!fallbackDays) return null;
  const base =
    baurundgang?.datumDurchgefuehrt ||
    baurundgang?.datumGeplant ||
    baurundgang?.erstelltAm ||
    new Date();
  const baseDate = base instanceof Date ? base : new Date(base);
  if (Number.isNaN(baseDate.getTime())) {
    return new Date(Date.now() + fallbackDays * 24 * 60 * 60 * 1000);
  }
  const frist = new Date(baseDate);
  frist.setDate(frist.getDate() + fallbackDays);
  return frist;
}

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

function mapTemplateRecord(record) {
  const bauteilTemplate = record?.kapitelTemplate?.bereichTemplate?.bauteilTemplate;
  const bereichTemplate = record?.kapitelTemplate?.bereichTemplate;
  const kapitelTemplate = record?.kapitelTemplate;

  const bauteilName = bauteilTemplate?.name ?? null;
  const bereichName = bereichTemplate?.name ?? null;
  const kapitelName = kapitelTemplate?.name ?? null;

  const text = record.text ?? "";

  return {
    id: record.id,
    text,
    textLower: text.toLowerCase(),
    bauteilTemplateId: bauteilTemplate?.id ?? null,
    bauteilName,
    bauteilNameLower: bauteilName?.toLowerCase() ?? "",
    bereichName,
    bereichNameLower: bereichName?.toLowerCase() ?? "",
    kapitelName,
    kapitelNameLower: kapitelName?.toLowerCase() ?? "",
  };
}

async function fetchTemplateIndex(prisma) {
  const records = await prisma.bereichKapitelTextTemplate.findMany({
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

  return records.map(mapTemplateRecord).filter((entry) => entry.bauteilTemplateId && entry.text);
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

async function ensurePosition(
  prisma,
  { qsReportId, baurundgangId, bauteilId, bauteilName, template, originalNote, frist },
) {
  const existingCount = await prisma.position.count({ where: { qsreportId: qsReportId } });

  let bauteil = null;
  if (bauteilId) {
    bauteil = await prisma.bauteil.findUnique({ where: { id: bauteilId } });
  } else if (bauteilName) {
    bauteil = await prisma.bauteil.findFirst({
      where: {
        baurundgangId,
        template: {
          name: { equals: bauteilName, mode: "insensitive" },
        },
      },
    });
  }

  const remarkParts = [];
  if (template?.text) {
    remarkParts.push(template.text);
  }
  if (originalNote) {
    const normalizedNote = originalNote.trim();
    if (normalizedNote && (!template?.text || !template.text.includes(normalizedNote))) {
      remarkParts.push(`Notiz: ${normalizedNote}`);
    }
  }
  const bemerkung = remarkParts.length ? remarkParts.join("\n\n") : template?.text ?? originalNote ?? null;

  return prisma.position.create({
    data: {
      qsreportId: qsReportId,
      positionsnummer: existingCount + 1,
      bauteilId: bauteilId ?? bauteil?.id ?? null,
      bemerkung,
      bereichstitel: template?.bereichName ?? bauteilName ?? undefined,
      frist: frist ?? undefined,
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
      "qsRundgang.positionCapture": (payload) => this.handlePositionCapture(payload),
    };
  }

  async handlePositionCapture({
    baurundgangId,
    note,
    photo,
    uploadedBy = "qs-mobile",
  }) {
    if (!this.fileInvoker || !this.databaseInvoker) {
      throw new Error("QsRundgangAgent: Tools sind nicht initialisiert.");
    }

    const errors = [];
    if (!baurundgangId) errors.push("baurundgangId");
    if (!note || typeof note !== "string" || !note.trim()) errors.push("note");
    if (!photo || (!photo.buffer && !photo.filePath)) errors.push("photo");

    if (errors.length) {
      return {
        status: "ERROR",
        message: `Folgende Felder fehlen oder sind ungültig: ${errors.join(", ")}`,
        context: { missing: errors },
      };
    }

    const prisma = this.databaseInvoker("rawClient");

    const baurundgang = await prisma.baurundgang.findUnique({
      where: { id: baurundgangId },
      include: {
        objekt: { select: { id: true, kundeId: true } },
      },
    });

    if (!baurundgang) {
      return {
        status: "ERROR",
        message: "Baurundgang wurde nicht gefunden.",
        context: { baurundgangId },
      };
    }

    const templates = await fetchTemplateIndex(prisma);
    const decision = determineMatchOutcome(note, templates);

    const bucket = decision.outcome === "clear" ? "qs-rundgang/photos" : "qs-rundgang/pending";
    const storedPhoto = await this.fileInvoker("storeUpload", {
      buffer: photo.buffer,
      filePath: photo.filePath,
      originalFilename: photo.originalFilename ?? "qs-foto.jpg",
      bucket,
    });

    if (decision.outcome !== "clear") {
      const options = decision.bestMatches.length
        ? Array.from(new Set(decision.bestMatches.map((item) => item.bauteilName).filter(Boolean)))
        : [];

      return {
        status: "NEEDS_INPUT",
        message: formatOptionsMessage(options),
        options,
        context: {
          storedPhoto,
          keywords: decision.keywords,
          outcome: decision.outcome,
        },
      };
    }

    const match = decision.bestMatches[0];

    let bauteil = null;
    if (match.bauteilTemplateId) {
      bauteil = await prisma.bauteil.findFirst({
        where: {
          baurundgangId,
          bauteilTemplateId: match.bauteilTemplateId,
        },
      });

      if (!bauteil) {
        bauteil = await prisma.bauteil.create({
          data: {
            baurundgang: { connect: { id: baurundgangId } },
            template: { connect: { id: match.bauteilTemplateId } },
          },
        });
      }
    }

    const report = await ensureReportDraft(prisma, {
      kundeId: baurundgang.objekt?.kundeId,
      objektId: baurundgang.objektId,
      baurundgangId,
    });

    const frist = computeFristDate(baurundgang);

    const position = await ensurePosition(prisma, {
      qsReportId: report.id,
      baurundgangId,
      bauteilId: bauteil?.id ?? null,
      bauteilName: match.bauteilName,
      template: match,
      originalNote: note,
      frist,
    });

    const foto = await prisma.foto.create({
      data: {
        baurundgang: { connect: { id: baurundgangId } },
        dateiURL: storedPhoto.storedPath,
        hinweisMarkierung: note,
      },
    });

    await prisma.positionFoto.create({
      data: {
        positionId: position.id,
        fotoId: foto.id,
      },
    });

    return {
      status: "SUCCESS",
      message: "Position erfolgreich erfasst.",
      context: {
        reportId: report.id,
        positionId: position.id,
        bauteilId: bauteil?.id ?? null,
        templateId: match.id,
        storedPhoto,
        frist,
        uploadedBy,
      },
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

    const position = await ensurePosition(prisma, {
      qsReportId: report.id,
      baurundgangId,
      bauteilName: classification.bauteilName,
      template: template
        ? {
            id: template.id,
            text: template.text,
            bereichName: template.kapitelTemplate?.bereichTemplate?.name,
          }
        : null,
      originalNote: processed.notes,
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

export const __test__ = { classifyNotes, determineMatchOutcome, formatOptionsMessage, rankTemplateMatches };
