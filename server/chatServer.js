import express from "express";
import multer from "multer";
import process from "node:process";

import { handleChatMessage } from "../src/agent/chat/handleChatMessage.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

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

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/chat/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "PDF-Datei unter Feldnamen 'file' erforderlich." });
    return;
  }

  const chatId = normalizeChatId(req.body?.chatId);
  try {
    const result = await handleChatMessage({
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

    res.json({ chatId, ...serializeResult(result) });
  } catch (error) {
    console.error("[chat/upload]", error);
    res.status(500).json({ error: "Fehler beim Verarbeiten des Bau-Beschriebs." });
  }
});

app.post("/chat/message", async (req, res) => {
  const { chatId, message, uploadedBy } = req.body ?? {};
  if (!chatId || typeof chatId !== "string") {
    res.status(400).json({ error: "chatId ist erforderlich." });
    return;
  }
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message ist erforderlich." });
    return;
  }

  try {
    const result = await handleChatMessage({ chatId, message, uploadedBy: uploadedBy ?? "http-chat" });
    res.json({ chatId, ...serializeResult(result) });
  } catch (error) {
    console.error("[chat/message]", error);
    res.status(500).json({ error: "Fehler beim Verarbeiten der Nachricht." });
  }
});

const port = Number.parseInt(process.env.CHAT_SERVER_PORT ?? "3001", 10);

app.listen(port, () => {
  console.log(`Chat-Server läuft auf http://localhost:${port}`);
});
