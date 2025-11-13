import { promises as fs } from "node:fs";
import path from "node:path";

import { defineTool } from "./toolTypes.js";

const DEFAULT_OUTBOX_DIR =
  process.env.MAIL_OUTBOX_DIR ?? path.join(process.cwd(), "storage", "mail", "reminders");

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

  const outbox = await ensureDirectory(DEFAULT_OUTBOX_DIR);
  const filename = `${queuedAt.replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}.json`;
  const filePath = path.join(outbox, filename);
  await fs.writeFile(filePath, JSON.stringify(entry, null, 2), "utf8");

  return { status: "queued", path: filePath, to: toList, queuedAt };
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
