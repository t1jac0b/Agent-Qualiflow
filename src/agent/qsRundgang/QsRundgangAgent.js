import path from "node:path";

import JSZip from "jszip";

import { createLogger } from "../../utils/logger.js";
import { createToolInvoker } from "../tools/toolTypes.js";

const NOTE_FILENAME_REGEX = /notizen?\.txt$/i;
const IMAGE_FILENAME_REGEX = /\.(?:png|jpe?g|webp|heic)$/i;

const KEYWORD_RULES = [
  { pattern: /strangabsperr\w*/i, bauteil: "Sanitär", label: "Strangabsperrventile" },
  { pattern: /entleer(?:ventil|ung)/i, bauteil: "Sanitär", label: "Entleerung" },
  { pattern: /sanit[äa]r/i, bauteil: "Sanitär", label: "Sanitär" },
  { pattern: /trinkwasser/i, bauteil: "Sanitär", label: "Trinkwasser" },
  { pattern: /leitung/i, bauteil: "Sanitär", label: "Leitung" },
  { pattern: /wasser/i, bauteil: "Sanitär", label: "Wasser" },
  { pattern: /xps\s*d[äa]mmung/i, bauteil: "Rohbau", label: "XPS Dämmung" },
  { pattern: /abdichtung/i, bauteil: "Rohbau", label: "Abdichtung" },
  { pattern: /beton/i, bauteil: "Rohbau", label: "Beton" },
];

const STOP_WORDS = new Set([
  "und",
  "oder",
  "ohne",
  "mit",
  "ein",
  "eine",
  "einer",
  "einem",
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "auf",
  "aus",
  "im",
  "in",
  "ins",
  "vom",
  "von",
  "zur",
  "zum",
  "für",
  "bei",
  "nach",
  "als",
  "ist",
  "sind",
]);

function extractKeywords(notesText = "") {
  const rawTokens = notesText.toLowerCase().match(/[a-z0-9äöüß]{3,}/gi) ?? [];
  const filtered = rawTokens
    .map((token) => token.trim())
    .filter((token) => token && token.length >= 3 && !STOP_WORDS.has(token));

  return Array.from(new Set(filtered));
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

const EXPLICIT_TEMPLATE_HINTS = [
  // Strongest: both tokens present in template text
  {
    pattern: /(?:strangabsperr.*entleer|entleer.*strangabsperr)/i,
    filter: (template) => template.textLower.includes("strangabsperr") && template.textLower.includes("entleer"),
  },
  // Fallbacks
  {
    pattern: /strangabsperr\w*/i,
    filter: (template) => template.textLower.includes("strangabsperr"),
  },
  {
    pattern: /entleer(?:ventil|ung)/i,
    filter: (template) => template.textLower.includes("entleer"),
  },
];

function rankTemplateMatches(notesText = "", templates = []) {
  const normalizedNote = notesText.toLowerCase();
  const keywords = extractKeywords(normalizedNote);
  const ruleMatches = KEYWORD_RULES.filter((rule) => rule.pattern.test(normalizedNote));

  for (const hint of EXPLICIT_TEMPLATE_HINTS) {
    if (!hint.pattern.test(normalizedNote)) continue;
    const directMatches = templates.filter((template) => hint.filter(template));
    if (directMatches.length === 1) {
      const direct = { ...directMatches[0], score: 100 };
      return { keywords, matches: [direct], ruleMatches };
    }
    if (directMatches.length > 1) {
      for (const template of templates) {
        if (directMatches.some((match) => match.id === template.id)) {
          template.__hintPriority = Math.max(template.__hintPriority ?? 0, 50);
        }
      }
    }
  }

  const matches = [];

  for (const template of templates) {
    const textLower = template.textLower ?? template.text.toLowerCase();
    const bauteilLower = template.bauteilNameLower ?? template.bauteilName?.toLowerCase() ?? "";
    const kapitelLower = template.kapitelNameLower ?? template.kapitelName?.toLowerCase() ?? "";

    let score = 0;
    for (const keyword of keywords) {
      if (!keyword) continue;
      if (textLower.includes(keyword)) score += 2;
      if (bauteilLower.includes(keyword)) score += 3;
      if (kapitelLower.includes(keyword)) score += 1;
    }

    for (const rule of ruleMatches) {
      const { pattern } = rule;
      if (rule.bauteil && bauteilLower.includes(rule.bauteil.toLowerCase())) {
        score += 3.5;
      }
      const patternMatchesText = pattern ? pattern.test(textLower) : false;
      if (patternMatchesText) {
        score += 3;
      } else if (rule.label && textLower.includes(rule.label.toLowerCase())) {
        score += 2.5;
      }
      if (pattern?.global) {
        pattern.lastIndex = 0;
      }
    }

    if (template.__hintPriority) {
      score += template.__hintPriority;
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
  let bestMatches = ranking.matches.filter((match) => match.score === bestScore);

  // Low-confidence: for very short/unspecific notes, return ambiguous and propose diverse options
  if (bestScore < 4) {
    const seenBauteile = new Set();
    const diverse = [];
    for (const m of ranking.matches) {
      const key = m.bauteilTemplateId ?? m.bauteilName ?? m.kapitelName ?? m.id;
      if (seenBauteile.has(key)) continue;
      seenBauteile.add(key);
      diverse.push(m);
      if (diverse.length >= 5) break;
    }
    return { ...ranking, bestMatches: diverse, outcome: "ambiguous" };
  }

  // Tie-breaker: if multiple best matches remain, prefer those that include both key tokens
  if (bestMatches.length > 1) {
    const bothToken = bestMatches.filter(
      (m) => (m.textLower ?? m.text.toLowerCase()).includes("strangabsperr") && (m.textLower ?? m.text.toLowerCase()).includes("entleer"),
    );
    if (bothToken.length === 1) {
      bestMatches = bothToken;
    } else if (bothToken.length > 1) {
      // Prefer shortest text (more specific standardtext)
      bothToken.sort((a, b) => (a.text?.length ?? Infinity) - (b.text?.length ?? Infinity));
      bestMatches = [bothToken[0]];
    }
  }

  // Tie-breaker: if still ambiguous and all share same bauteil, pick lowest id deterministically
  if (bestMatches.length > 1) {
    const allSameBauteil = bestMatches.every((m) => m.bauteilTemplateId === bestMatches[0].bauteilTemplateId);
    if (allSameBauteil) {
      bestMatches.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
      bestMatches = [bestMatches[0]];
    }
  }

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

async function fetchTemplateIndex(prisma) {
  const records = await prisma.bereichKapitelTextTemplate.findMany({
    include: {
      kapitelTemplate: {
        include: {
          bauteilTemplate: true,
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
        bauteilTemplate: {
          name: { equals: bauteilName, mode: "insensitive" },
        },
      },
    },
    include: {
      kapitelTemplate: {
        include: {
          bauteilTemplate: true,
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

  const kapitelName = template?.kapitelName ?? bauteilName ?? null;

  // Try to find an existing position for same bauteil and same bereich/kapitel
  const where = { qsreportId: qsReportId };
  if (bauteilId || bauteil?.id) {
    where.bauteilId = bauteilId ?? bauteil?.id;
  } else {
    where.bauteilId = null;
  }
  if (kapitelName) {
    where.bereichstitel = kapitelName;
  }

  let existing = null;
  try {
    existing = await prisma.position.findFirst({ where, orderBy: { id: "asc" } });
  } catch (e) {
    existing = null;
  }

  // Build remark fragment for current capture
  const parts = [];
  if (template?.text) parts.push(template.text);
  if (originalNote) {
    const normalizedNote = originalNote.trim();
    if (normalizedNote) parts.push(`Notiz: ${normalizedNote}`);
  }
  const fragment = parts.length ? parts.join("\n\n") : null;

  if (existing) {
    const base = existing.bemerkung ?? "";
    let newBemerkung = base;
    if (fragment && !base.includes(fragment)) {
      newBemerkung = base ? `${base}\n\n${fragment}` : fragment;
    }
    const needsKapitel = kapitelName && !existing.bereichstitel;
    if (newBemerkung !== base || needsKapitel) {
      existing = await prisma.position.update({
        where: { id: existing.id },
        data: {
          bemerkung: newBemerkung,
          bereichstitel: needsKapitel ? kapitelName : existing.bereichstitel,
        },
      });
    }
    return existing;
  }

  const bemerkung = fragment ?? null;
  return prisma.position.create({
    data: {
      qsreportId: qsReportId,
      positionsnummer: existingCount + 1,
      bauteilId: bauteilId ?? bauteil?.id ?? null,
      bemerkung,
      bereichstitel: kapitelName ?? undefined,
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
      "qsRundgang.positionClarify": (payload) => this.handlePositionClarify(payload),
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

  async handlePositionClarify({ baurundgangId, note, option, storedPhotoPath, uploadedBy = "qs-mobile" }) {
    if (!this.fileInvoker || !this.databaseInvoker) {
      throw new Error("QsRundgangAgent: Tools sind nicht initialisiert.");
    }

    const errors = [];
    if (!baurundgangId) errors.push("baurundgangId");
    if (!note || typeof note !== "string" || !note.trim()) errors.push("note");
    if (!option || typeof option !== "string" || !option.trim()) errors.push("option");
    if (errors.length) {
      return { status: "ERROR", message: `Folgende Felder fehlen oder sind ungültig: ${errors.join(", ")}` };
    }

    const prisma = this.databaseInvoker("rawClient");
    const baurundgang = await prisma.baurundgang.findUnique({
      where: { id: baurundgangId },
      include: { objekt: { select: { id: true, kundeId: true } } },
    });
    if (!baurundgang) {
      return { status: "ERROR", message: "Baurundgang wurde nicht gefunden.", context: { baurundgangId } };
    }

    const allTemplates = await fetchTemplateIndex(prisma);
    const filtered = allTemplates.filter((t) => (t.bauteilName ?? "").toLowerCase() === option.toLowerCase());
    const pool = filtered.length ? filtered : allTemplates.filter((t) => (t.bauteilName ?? "").toLowerCase().includes(option.toLowerCase()));

    if (pool.length === 0) {
      return { status: "ERROR", message: `Kein Template für Option '${option}' gefunden.` };
    }

    const decision = determineMatchOutcome(note, pool);
    const match = decision.bestMatches[0] ?? pool[0];

    let bauteil = null;
    if (match.bauteilTemplateId) {
      bauteil = await prisma.bauteil.findFirst({ where: { baurundgangId, bauteilTemplateId: match.bauteilTemplateId } });
      if (!bauteil) {
        bauteil = await prisma.bauteil.create({
          data: {
            baurundgang: { connect: { id: baurundgangId } },
            template: { connect: { id: match.bauteilTemplateId } },
          },
        });
      }
    }

    const report = await ensureReportDraft(prisma, { kundeId: baurundgang.objekt?.kundeId, objektId: baurundgang.objektId, baurundgangId });
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

    let foto = null;
    if (storedPhotoPath) {
      foto = await prisma.foto.create({
        data: {
          baurundgang: { connect: { id: baurundgangId } },
          dateiURL: storedPhotoPath,
          hinweisMarkierung: note,
        },
      });
      await prisma.positionFoto.create({ data: { positionId: position.id, fotoId: foto.id } });
    }

    return {
      status: "SUCCESS",
      message: "Position erfolgreich erfasst.",
      context: {
        reportId: report.id,
        positionId: position.id,
        bauteilId: bauteil?.id ?? null,
        templateId: match.id,
        storedPhoto: foto ? { storedPath: storedPhotoPath } : undefined,
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

    // Direct matching against catalog templates
    const templates = await fetchTemplateIndex(prisma);
    const decision = determineMatchOutcome(processed.notes, templates);

    const bucket = decision.outcome === "clear" ? "qs-rundgang/photos" : "qs-rundgang/pending";
    const storedPhoto = await this.fileInvoker("storeUpload", {
      buffer,
      filePath,
      originalFilename: originalFilename ?? "qs-foto.jpg",
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
          storedArchive,
          storedPhoto,
          photos: processed.photos,
          keywords: decision.keywords,
          outcome: decision.outcome,
        },
      };
    }

    const match = decision.bestMatches[0];

    let bauteil = null;
    if (match.bauteilTemplateId) {
      bauteil = await prisma.bauteil.findFirst({
        where: { baurundgangId, bauteilTemplateId: match.bauteilTemplateId },
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

    const report = await ensureReportDraft(prisma, { kundeId, objektId, baurundgangId });
    const frist = computeFristDate(baurundgang);

    const position = await ensurePosition(prisma, {
      qsReportId: report.id,
      baurundgangId,
      bauteilId: bauteil?.id ?? null,
      bauteilName: match.bauteilName,
      template: match,
      originalNote: processed.notes,
      frist,
    });

    const foto = await prisma.foto.create({
      data: {
        baurundgang: { connect: { id: baurundgangId } },
        dateiURL: storedPhoto.storedPath,
        hinweisMarkierung: processed.notes,
      },
    });

    await prisma.positionFoto.create({ data: { positionId: position.id, fotoId: foto.id } });

    return {
      status: "SUCCESS",
      message: "QS-Rundgang-Daten verarbeitet",
      context: {
        storedArchive,
        storedPhoto,
        photos: processed.photos,
        templateId: match.id,
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
