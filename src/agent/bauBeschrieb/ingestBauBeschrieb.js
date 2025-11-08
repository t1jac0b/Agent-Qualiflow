import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pdfParse from "pdf-parse";

const STORAGE_ROOT = path.join(process.cwd(), "storage", "uploads", "bau-beschrieb");

async function ensureStorageDir() {
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
}

function ensureBuffer({ buffer, filePath }) {
  if (buffer) return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!filePath) {
    throw new Error("ingestBauBeschrieb: 'buffer' oder 'filePath' muss gesetzt sein.");
  }
  return fs.readFile(filePath);
}

function buildStoredFilename(originalFilename = "bau-beschrieb.pdf") {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const hash = crypto.randomBytes(6).toString("hex");
  const ext = path.extname(originalFilename) || ".pdf";
  const base = path.basename(originalFilename, ext).replace(/[^a-z0-9-_]+/gi, "-") || "bau-beschrieb";
  return `${base}-${timestamp}-${hash}${ext}`.toLowerCase();
}

export async function ingestBauBeschrieb({ buffer, filePath, originalFilename, uploadedBy }) {
  const pdfBuffer = await ensureBuffer({ buffer, filePath });
  await ensureStorageDir();

  const storedFilename = buildStoredFilename(originalFilename);
  const storedPath = path.join(STORAGE_ROOT, storedFilename);
  await fs.writeFile(storedPath, pdfBuffer);

  const { text } = await pdfParse(pdfBuffer);

  return {
    storedPath,
    storedFilename,
    extractedText: text,
    uploadedBy: uploadedBy ?? null,
    originalFilename: originalFilename ?? path.basename(filePath ?? "bau-beschrieb.pdf"),
    uploadedAt: new Date().toISOString(),
  };
}
