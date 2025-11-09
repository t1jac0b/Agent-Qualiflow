import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pdfParse from "pdf-parse";

import { defineTool } from "./toolTypes.js";

const STORAGE_ROOT = path.join(process.cwd(), "storage");

function sanitizeSegment(segment) {
  return segment.replace(/[^a-z0-9-_\/]+/gi, "-").replace(/\/+/, "/").replace(/^\/+|\/+$/g, "");
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function resolveBuffer({ buffer, filePath }) {
  if (buffer) {
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  }
  if (!filePath) {
    throw new Error("fileTool.resolveBuffer: 'buffer' oder 'filePath' ist erforderlich.");
  }
  return fs.readFile(filePath);
}

function buildStoredFilename(originalFilename = "upload.bin") {
  const ext = path.extname(originalFilename) || ".bin";
  const base = path.basename(originalFilename, ext).replace(/[^a-z0-9-_]+/gi, "-") || "upload";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const hash = crypto.randomBytes(6).toString("hex");
  return `${base}-${timestamp}-${hash}${ext}`.toLowerCase();
}

async function storeUpload({ buffer, filePath, originalFilename, bucket = "misc" }) {
  const data = await resolveBuffer({ buffer, filePath });
  const bucketPath = sanitizeSegment(bucket);
  const targetDir = path.join(STORAGE_ROOT, bucketPath);
  await ensureDir(targetDir);
  const storedFilename = buildStoredFilename(originalFilename ?? path.basename(filePath ?? "upload.bin"));
  const storedPath = path.join(targetDir, storedFilename);
  await fs.writeFile(storedPath, data);
  return { storedPath, storedFilename };
}

async function parsePdf({ buffer, filePath }) {
  const data = await resolveBuffer({ buffer, filePath });
  const result = await pdfParse(data);
  return { text: result.text, info: result.info, metadata: result.metadata, numrender: result.numpages ?? result.numrender };
}

async function readFile({ storedPath, encoding }) {
  return fs.readFile(storedPath, encoding);
}

async function deleteFile({ storedPath }) {
  try {
    await fs.unlink(storedPath);
    return { deleted: true };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { deleted: false, reason: "not_found" };
    }
    throw error;
  }
}

export const fileTool = defineTool({
  name: "file",
  description: "Handles file storage and parsing for agent workflows.",
  metadata: { kind: "file", storageRoot: STORAGE_ROOT },
  actions: {
    resolveBuffer,
    storeUpload,
    parsePdf,
    readFile,
    deleteFile,
  },
});
