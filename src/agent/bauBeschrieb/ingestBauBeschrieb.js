import path from "node:path";

import { fileTool } from "../tools/fileTool.js";

const { storeUpload, parsePdf } = fileTool.actions;

export async function ingestBauBeschrieb({ buffer, filePath, originalFilename, uploadedBy }) {
  const bucket = path.join("uploads", "bau-beschrieb");
  const uploadResult = await storeUpload({ buffer, filePath, originalFilename, bucket });
  const { text } = await parsePdf({ buffer, filePath: uploadResult.storedPath });

  return {
    storedPath: uploadResult.storedPath,
    storedFilename: uploadResult.storedFilename,
    extractedText: text,
    uploadedBy: uploadedBy ?? null,
    originalFilename: originalFilename ?? path.basename(filePath ?? uploadResult.storedFilename),
    uploadedAt: new Date().toISOString(),
  };
}
