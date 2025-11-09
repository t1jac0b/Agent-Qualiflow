import path from "node:path";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { handleBauBeschriebUpload } from "../src/agent/chat/handleBauBeschriebUpload.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/testBauBeschrieb.js <path-to-bau-beschrieb.pdf>");
    process.exit(1);
  }

  const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.join(__dirname, "..", inputPath);

  let buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch (error) {
    console.error(`Could not read file at ${absolutePath}:`, error.message);
    process.exit(1);
  }

  const result = await handleBauBeschriebUpload({
    buffer,
    originalFilename: path.basename(absolutePath),
    uploadedBy: "cli-test",
  });

  console.log("Status:", result.status);
  console.log("Message:\n" + result.message);

  if (result.status === "needs_input" && result.context?.extracted) {
    console.log("\nExtracted metadata:", JSON.stringify(result.context.extracted, null, 2));
    if (result.context.ingestion?.extractedText) {
      const previewLines = result.context.ingestion.extractedText.split(/\r?\n/).slice(0, 40);
      console.log("\nText preview:");
      previewLines.forEach((line, idx) => {
        console.log(String(idx + 1).padStart(2, "0"), line);
      });
    }
  }

  if (result.context?.kunde) {
    console.log("\nKunde-ID:", result.context.kunde.id);
  }
  if (result.context?.objekt) {
    console.log("Objekt-ID:", result.context.objekt.id);
  }
  if (result.context?.ingestion?.storedPath) {
    console.log("Gespeichert unter:", result.context.ingestion.storedPath);
  }
}

main().catch((error) => {
  console.error("Unhandled error during Bau-Beschrieb test:", error);
  process.exit(1);
});
