import express from "express";
import multer from "multer";
import process from "node:process";

import { handleChatMessage } from "../src/agent/chat/handleChatMessage.js";
import { getAgentOrchestrator } from "../src/agent/index.js";
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

app.use(express.json({ limit: "5mb" }));

function normalizeChatId(requestedId) {
  if (requestedId && typeof requestedId === "string" && requestedId.trim()) {
    return requestedId.trim();
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function serializeResult(result) {
  if (!result) return { status: "unknown" };
  const { status, message, context } = result;
  return {
    status,
    message,
    context,
  };
}

function buildFollowUpMessage(body) {
  if (!body) return null;

  const lines = [];

  if (typeof body.message === "string" && body.message.trim()) {
    lines.push(body.message.trim());
  }

  if (typeof body.projektleiter === "string" && body.projektleiter.trim()) {
    lines.push(`Projektleiter: ${body.projektleiter.trim()}`);
  }

  const emailInput = body.projektleiter_email ?? body.projektleiterEmail;
  if (typeof emailInput === "string" && emailInput.trim()) {
    lines.push(`Projektleiter Email: ${emailInput.trim()}`);
  }

  const telefonInput = body.projektleiter_telefon ?? body.projektleiterTelefon;
  if (typeof telefonInput === "string" && telefonInput.trim()) {
    lines.push(`Projektleiter Tel: ${telefonInput.trim()}`);
  }

  return lines.length ? lines.join("\n") : null;
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/chat/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    log.warn("Upload ohne Datei", { route: "/chat/upload" });
    res.status(400).json({ error: "PDF-Datei unter Feldnamen 'file' erforderlich." });
    return;
  }

  const chatId = normalizeChatId(req.body?.chatId);
  try {
    log.info("Verarbeite Upload", {
      chatId,
      originalFilename: req.file.originalname,
      hasMessage: Boolean(req.body?.message),
      hasProjektleiter: Boolean(req.body?.projektleiter ?? req.body?.projektleiter_email ?? req.body?.projektleiterEmail),
    });

    let result = await handleChatMessage({
      chatId,
      attachments: [
        {
          buffer: req.file.buffer,
          originalFilename: req.file.originalname,
          mimetype: req.file.mimetype,
        },
      ],
      uploadedBy: req.body?.uploadedBy ?? "http-chat",
    });

    const followUpMessage = buildFollowUpMessage(req.body);
    if (result.status === "needs_input" && followUpMessage) {
      log.info("Sende automatisches Follow-up", { chatId });
      result = await handleChatMessage({
        chatId,
        message: followUpMessage,
        uploadedBy: req.body?.uploadedBy ?? "http-chat",
      });
    }

    log.info("Upload verarbeitet", { chatId, status: result.status });
    res.json({ chatId, ...serializeResult(result) });
  } catch (error) {
    log.error("Fehler beim Upload", { chatId, error });
    res.status(500).json({ error: "Fehler beim Verarbeiten des Bau-Beschriebs." });
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

app.post("/chat/message", async (req, res) => {
  const { chatId, message, uploadedBy } = req.body ?? {};
  if (!chatId || typeof chatId !== "string") {
    log.warn("chatId fehlt", { route: "/chat/message" });
    res.status(400).json({ error: "chatId ist erforderlich." });
    return;
  }
  if (!message || typeof message !== "string") {
    log.warn("message fehlt", { route: "/chat/message", chatId });
    res.status(400).json({ error: "message ist erforderlich." });
    return;
  }

  try {
    log.info("Verarbeite Nachricht", { chatId });
    const result = await handleChatMessage({ chatId, message, uploadedBy: uploadedBy ?? "http-chat" });
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
