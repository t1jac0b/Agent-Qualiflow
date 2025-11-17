import { promises as fs } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";

import { defineTool } from "./toolTypes.js";

const DEFAULT_OUTBOX_DIR =
  process.env.MAIL_OUTBOX_DIR ?? path.join(process.cwd(), "storage", "mail", "reminders");

let transporter = null;
let etherealAccount = null;

async function getTransporter() {
  // Check flags at runtime so dotenv has already populated process.env
  const MAIL_SEND_ENABLED = process.env.MAIL_SEND_ENABLED === "true";
  const MAIL_USE_ETHEREAL = process.env.MAIL_USE_ETHEREAL === "true";

  if (!MAIL_SEND_ENABLED) {
    return null;
  }

  if (MAIL_USE_ETHEREAL) {
    if (!transporter) {
      etherealAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: etherealAccount.smtp.host,
        port: etherealAccount.smtp.port,
        secure: etherealAccount.smtp.secure,
        auth: {
          user: etherealAccount.user,
          pass: etherealAccount.pass,
        },
      });
      console.log("[mailTool] Ethereal Test Account", {
        user: etherealAccount.user,
        pass: etherealAccount.pass,
      });
    }
    return transporter;
  }

  if (!transporter) {
    const config = {
      host: process.env.SMTP_HOST,
      port: Number.parseInt(process.env.SMTP_PORT ?? "587", 10),
      secure: false, // Use STARTTLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        ciphers: "SSLv3",
        rejectUnauthorized: false, // For Office365 compatibility
      },
    };

    if (!config.auth.user || !config.auth.pass) {
      console.warn("[mailTool] SMTP credentials missing. Email sending disabled.");
      return null;
    }

    transporter = nodemailer.createTransport(config);
  }
  return transporter;
}

function normalizeRecipients(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  return String(value)
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

async function queueReminder({ to, cc = [], bcc = [], subject, body, meta = {} } = {}) {
  const toList = normalizeRecipients(to);
  if (!toList.length) {
    throw new Error("queueReminder: 'to' muss mindestens eine Adresse enthalten.");
  }

  const ccList = normalizeRecipients(cc);
  const bccList = normalizeRecipients(bcc);

  const queuedAt = new Date().toISOString();
  const entry = {
    type: "reminder",
    queuedAt,
    to: toList,
    cc: ccList,
    bcc: bccList,
    subject: subject ?? "Rückmeldung offen",
    body: body ?? "",
    meta,
  };

  // Save to filesystem as backup
  const outbox = await ensureDirectory(DEFAULT_OUTBOX_DIR);
  const filename = `${queuedAt.replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}.json`;
  const filePath = path.join(outbox, filename);
  await fs.writeFile(filePath, JSON.stringify(entry, null, 2), "utf8");

  // Send via SMTP if enabled
  let emailSent = false;
  let emailError = null;
  let previewUrl = null;
  const MAIL_SEND_ENABLED = process.env.MAIL_SEND_ENABLED === "true";
  if (MAIL_SEND_ENABLED) {
    const smtp = await getTransporter();
    if (smtp) {
      try {
        const mailOptions = {
          from: process.env.SMTP_FROM ?? etherealAccount?.user ?? process.env.SMTP_USER,
          to: toList.join(", "),
          cc: ccList.length ? ccList.join(", ") : undefined,
          bcc: bccList.length ? bccList.join(", ") : undefined,
          subject: entry.subject,
          text: entry.body,
        };

        const info = await smtp.sendMail(mailOptions);
        emailSent = true;
        console.log(`[mailTool] E-Mail gesendet: ${info.messageId} an ${toList.join(", ")}`);
        if (process.env.MAIL_USE_ETHEREAL === "true") {
          previewUrl = nodemailer.getTestMessageUrl(info);
          if (previewUrl) {
            console.log(`[mailTool] Ethereal Vorschau: ${previewUrl}`);
          }
        }
      } catch (error) {
        emailError = error.message;
        console.error(`[mailTool] E-Mail-Versand fehlgeschlagen:`, error);
      }
    }
  }

  return {
    status: emailSent ? "sent" : "queued",
    path: filePath,
    to: toList,
    queuedAt,
    emailSent,
    emailError,
    previewUrl,
  };
}

export const mailTool = defineTool({
  name: "mail",
  description: "Handles mail draft creation and reminder notifications.",
  metadata: { kind: "mail", status: "filesystem-queue" },
  actions: {
    createDraft: ({ to, subject, body }) => ({ status: "drafted", to, subject, body }),
    queueReminder,
  },
});
