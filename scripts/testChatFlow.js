import path from "node:path";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { handleChatMessage } from "../src/agent/chat/handleChatMessage.js";
import { clearSession } from "../src/agent/chat/sessionStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function printResult(label, result) {
  console.log(`\n${label}:`);
  console.log("Status:", result.status);
  if (result.message) {
    console.log("Message:\n" + result.message);
  }
  if (result.context?.kunde) {
    console.log("Kunde-ID:", result.context.kunde.id);
  }
  if (result.context?.objekt) {
    console.log("Objekt-ID:", result.context.objekt.id);
  }
  if (result.context?.ingestion?.storedPath) {
    console.log("Gespeichert unter:", result.context.ingestion.storedPath);
  }
}

async function main() {
  const [inputPath, ...rest] = process.argv.slice(2);
  if (!inputPath) {
    console.error("Usage: node scripts/testChatFlow.js <path-to-bau-beschrieb.pdf> [follow-up message]");
    process.exit(1);
  }

  const followUpMessage = rest.join(" ").trim();

  const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.join(__dirname, "..", inputPath);

  let buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch (error) {
    console.error(`Could not read file at ${absolutePath}:`, error.message);
    process.exit(1);
  }

  const chatId = `cli-${Date.now()}`;

  const uploadResult = await handleChatMessage({
    chatId,
    attachments: [
      {
        buffer,
        originalFilename: path.basename(absolutePath),
      },
    ],
    uploadedBy: "cli-test",
  });

  printResult("Upload", uploadResult);

  if (uploadResult.status !== "needs_input") {
    clearSession(chatId);
    return;
  }

  if (!followUpMessage) {
    console.log("\nNo follow-up message provided. Re-run the script with the additional information, e.g.:\n");
    console.log(
      `  node scripts/testChatFlow.js ${inputPath} "PLZ: 3013 Ort: Bern\nProjektleiter: Max Beispiel"`
    );
    return;
  }

  const followUpResult = await handleChatMessage({
    chatId,
    message: followUpMessage,
  });

  printResult("Follow-up", followUpResult);

  clearSession(chatId);
}

main().catch((error) => {
  console.error("Unhandled error during chat flow test:", error);
  process.exit(1);
});
