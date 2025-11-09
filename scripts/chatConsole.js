import path from "node:path";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { handleChatMessage } from "../src/agent/chat/handleChatMessage.js";
import { clearSession } from "../src/agent/chat/sessionStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chatId = `interactive-${Date.now()}`;

function printResult(label, result) {
  console.log(`\n${label}:`);
  console.log("Status:", result.status ?? "unknown");
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
  if (result.context?.reportPath) {
    console.log("Report:", result.context.reportPath);
  }
}

function printHelp() {
  console.log(`\nBau-Beschrieb Chat CLI\n----------------------\n`);
  console.log(`Commands:`);
  console.log(`  /upload <pfad-zur-pdf>  Lädt einen Bau-Beschrieb hoch`);
  console.log(`  /help                   Zeigt diese Hilfe`);
  console.log(`  /quit                   Beendet die Sitzung`);
  console.log(``);
  console.log(`Normale Texteingaben werden als Chat-Nachricht gesendet (z. B. Projektleiter).`);
}

async function handleUpload(filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  let buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch (error) {
    console.error(`Konnte Datei nicht lesen (${absolutePath}):`, error.message);
    return;
  }

  const result = await handleChatMessage({
    chatId,
    attachments: [
      {
        buffer,
        originalFilename: path.basename(absolutePath),
      },
    ],
    uploadedBy: "chat-cli",
  });

  printResult("Upload", result);
}

async function main() {
  printHelp();

  const rl = createInterface({ input, output, prompt: "> " });

  rl.prompt();

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        continue;
      }

      if (trimmed === "/quit") {
        break;
      }

      if (trimmed === "/help") {
        printHelp();
        rl.prompt();
        continue;
      }

      if (trimmed.startsWith("/upload ")) {
        const filePath = trimmed.slice("/upload ".length).trim();
        if (!filePath) {
          console.log("Bitte einen Pfad zur PDF angeben.");
        } else {
          await handleUpload(filePath);
        }
        rl.prompt();
        continue;
      }

      const result = await handleChatMessage({ chatId, message: trimmed, uploadedBy: "chat-cli" });
      printResult("Nachricht", result);
      rl.prompt();
    }
  } finally {
    clearSession(chatId);
    rl.close();
    console.log("Session beendet.");
  }
}

main().catch((error) => {
  console.error("Unerwarteter Fehler im Chat CLI:", error);
  clearSession(chatId);
  process.exit(1);
});
