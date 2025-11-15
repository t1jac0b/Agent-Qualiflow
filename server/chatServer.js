import "dotenv/config";
import express from "express";
import multer from "multer";
import process from "node:process";
import path from "node:path";

import { beginQualiFlowConversation, getAgentOrchestrator, getChatOrchestrator, handleQualiFlowMessage } from "../src/agent/index.js";
import { createLogger } from "../src/utils/logger.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const log = createLogger("http:chat");
const orchestrator = getAgentOrchestrator();
const qsUpload = upload.fields([
  { name: "archive", maxCount: 1 },
  { name: "photos", maxCount: 20 },
]);
const qsPositionUpload = upload.single("photo");
const chatUpload = upload.single("file");

app.use(express.json({ limit: "5mb" }));
// Serve static UI from /client
app.use(express.static("client"));

function normalizeChatId(requestedId) {
  if (requestedId && typeof requestedId === "string" && requestedId.trim()) {
    return requestedId.trim();
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function serializeResult(result) {
  if (!result) return { status: "unknown" };
  const { status, message, context, options } = result;
  return {
    status,
    message,
    options,
    context,
  };
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/qs-rundgang/position-clarify", async (req, res) => {
  const parseId = (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const baurundgangId = parseId(req.body?.baurundgangId);
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  const option = typeof req.body?.option === "string" ? req.body.option.trim() : "";
  const storedPhotoPath = typeof req.body?.storedPhotoPath === "string" ? req.body.storedPhotoPath.trim() : undefined;

  if (!baurundgangId || !note || !option) {
    res.status(400).json({
      status: "ERROR",
      message: "Erforderliche Felder fehlen.",
      missing: [
        ...(baurundgangId ? [] : ["baurundgangId"]),
        ...(note ? [] : ["note"]),
        ...(option ? [] : ["option"]),
      ],
    });
    return;
  }

  try {
    const result = await orchestrator.handleTask({
      type: "qsRundgang.positionClarify",
      payload: {
        baurundgangId,
        note,
        option,
        storedPhotoPath,
        uploadedBy: req.body?.uploadedBy ?? "http-qs",
      },
    });

    const statusCode = result?.status === "ERROR" ? 400 : 201;
    res.status(statusCode).json(serializeResult(result));
  } catch (error) {
    log.error("QS-Rundgang Position clarify fehlgeschlagen", { error, baurundgangId });
    res.status(500).json({ error: "Fehler beim Erstellen der QS-Position (Clarify)." });
  }
});

app.get("/qs-rundgang/:id/report", async (req, res) => {
  const parseId = (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const baurundgangId = parseId(req.params.id);
  if (!baurundgangId) {
    res.status(400).json({ status: "ERROR", message: "Ungültige Baurundgang-ID." });
    return;
  }

  try {
    const result = await orchestrator.handleTask({
      type: "report.generate",
      payload: { baurundgangId },
    });

    if (result?.status !== "SUCCESS") {
      console.error("[HTTP] report.generate unexpected status", {
        status: result?.status,
        message: result?.message,
        context: result,
      });
      res.status(500).json({
        status: result?.status ?? "ERROR",
        message: result?.message ?? "Report konnte nicht generiert werden.",
        context: result?.context,
      });
      return;
    }

    res.json({ status: "SUCCESS", pdfPath: result.pdfPath, reportId: result.reportId });
  } catch (error) {
    log.error("QS-Report Generierung fehlgeschlagen", { error, baurundgangId });
    console.error("[HTTP] /qs-rundgang/:id/report failed", error);
    res.status(500).json({
      status: "ERROR",
      message: error?.message ?? "Report konnte nicht generiert werden.",
    });
  }
});

app.post("/qs-rundgang/position-erfassen", qsPositionUpload, async (req, res) => {
  const parseId = (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const baurundgangId = parseId(req.body?.baurundgangId);
  const rawNote = req.body?.note ?? req.body?.notiz ?? "";
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  const photo = req.file
    ? {
        buffer: req.file.buffer,
        originalFilename: req.file.originalname,
        mimetype: req.file.mimetype,
      }
    : null;

  const missing = [];
  if (!baurundgangId) missing.push("baurundgangId");
  if (!note) missing.push("note");
  if (!photo) missing.push("photo");

  if (missing.length) {
    log.warn("QS-Rundgang Position fehlende Felder", { baurundgangId, missing });
    res.status(400).json({ status: "ERROR", message: "Erforderliche Felder fehlen.", missing });
    return;
  }

  try {
    log.info("QS-Rundgang Position", {
      baurundgangId,
      hasPhoto: true,
      hasNote: true,
    });

    const result = await orchestrator.handleTask({
      type: "qsRundgang.positionCapture",
      payload: {
        baurundgangId,
        note,
        photo,
        uploadedBy: req.body?.uploadedBy ?? "http-qs",
      },
    });

    if (result?.status === "ERROR") {
      res.status(400).json(result);
      return;
    }

    const statusCode = result?.status === "NEEDS_INPUT" ? 200 : 201;
    res.status(statusCode).json(serializeResult(result));
  } catch (error) {
    log.error("QS-Rundgang Position fehlgeschlagen", { error, baurundgangId });
    res.status(500).json({ error: "Fehler beim Erfassen der QS-Position." });
  }
});

app.post("/qs-rundgang/upload", qsUpload, async (req, res) => {
  const parseId = (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const archiveFile = req.files?.archive?.[0];
  const photoFiles = Array.isArray(req.files?.photos) ? req.files.photos : [];

  const payload = {
    buffer: archiveFile?.buffer,
    filePath: archiveFile?.path,
    originalFilename: archiveFile?.originalname,
    uploadedBy: req.body?.uploadedBy ?? "http-qs",
    kundeId: parseId(req.body?.kundeId),
    objektId: parseId(req.body?.objektId),
    baurundgangId: parseId(req.body?.baurundgangId),
    notesText: req.body?.notes ?? req.body?.notizen ?? "",
    photos: photoFiles.map((file) => ({
      buffer: file.buffer,
      originalFilename: file.originalname,
      mimetype: file.mimetype,
    })),
  };

  try {
    log.info("QS-Rundgang Upload", {
      hasArchive: Boolean(archiveFile),
      photoCount: photoFiles.length,
      hasNotes: Boolean(payload.notesText?.trim()),
      kundeId: payload.kundeId,
      objektId: payload.objektId,
      baurundgangId: payload.baurundgangId,
    });

    const result = await orchestrator.handleTask({ type: "qsRundgang.upload", payload });

    log.info("QS-Rundgang Upload verarbeitet", {
      status: result?.status,
      reportId: result?.context?.reportId,
      positionId: result?.context?.positionId,
    });

    res.json(serializeResult(result));
  } catch (error) {
    log.error("QS-Rundgang Upload fehlgeschlagen", { error });
    res.status(500).json({ error: "Fehler beim Verarbeiten des QS-Rundgang-Uploads." });
  }
});

app.post("/chat/upload", chatUpload, async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ status: "ERROR", message: "Keine Datei hochgeladen." });
    return;
  }

  const chatId = normalizeChatId(req.body?.chatId);

  try {
    const chatOrchestrator = getChatOrchestrator();
    const fileTool = chatOrchestrator?.tools?.file;
    if (!fileTool?.actions?.storeUpload) {
      throw new Error("fileTool.storeUpload ist nicht verfügbar");
    }

    const bucket = `chat-uploads/${chatId}`;
    const stored = await fileTool.actions.storeUpload({
      buffer: file.buffer,
      originalFilename: file.originalname,
      bucket,
    });

    const registered = chatOrchestrator.registerAttachment(chatId, {
      id: stored.storedPath,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      storedFilename: stored.storedFilename,
      bucket,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.body?.uploadedBy ?? "chat-ui",
    });

    res.status(200).json({
      chatId,
      status: "attachment_stored",
      message: `Die Datei "${file.originalname}" ist bereit. Bitte beschreibe in deiner Nachricht, was passieren soll.`,
      context: { attachment: registered },
    });
  } catch (error) {
    log.error("Chat Upload fehlgeschlagen", { error, filename: file.originalname });
    res.status(500).json({ status: "ERROR", message: "Upload konnte nicht verarbeitet werden." });
  }
});

app.post("/chat/message", async (req, res) => {
  const { chatId: requestedChatId, message, uploadedBy, attachmentId } = req.body ?? {};
  const chatId = normalizeChatId(requestedChatId);
  try {
    const trimmed = typeof message === "string" ? message.trim() : "";

    if (!trimmed) {
      log.info("Proaktiven Gesprächsstart ausführen", { chatId });
      const result = await beginQualiFlowConversation(chatId);
      log.info("Proaktive Begrüßung gesendet", { chatId, status: result.status });
      res.json({ chatId, ...serializeResult(result) });
      return;
    }

    log.info("Verarbeite Nachricht (LLM)", { chatId });
    const result = await handleQualiFlowMessage({ chatId, message, attachmentId, uploadedBy });
    log.info("Nachricht verarbeitet", { chatId, status: result.status });
    res.json({ chatId, ...serializeResult(result) });
  } catch (error) {
    log.error("Fehler bei Nachricht", { chatId, error });
    res.status(500).json({ error: "Fehler beim Verarbeiten der Nachricht." });
  }
});

const port = Number.parseInt(process.env.CHAT_SERVER_PORT ?? "3001", 10);

app.listen(port, () => {
  log.info("Chat-Server gestartet", { port });
});
