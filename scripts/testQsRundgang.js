import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";
import { once } from "node:events";
import { Blob } from "node:buffer";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PORT = Number.parseInt(process.env.CHAT_SERVER_PORT ?? "3101", 10);
const BASE_URL = process.env.QS_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const projectRoot = path.resolve(process.cwd());
const dummyPhotoPath = path.join(projectRoot, "test-assets", "dummy-foto.jpg");

function logSection(title, payload) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(payload, null, 2));
}

async function ensureDummyPhotoExists() {
  try {
    await fs.access(dummyPhotoPath);
  } catch (error) {
    throw new Error(`Dummy-Foto nicht gefunden unter ${dummyPhotoPath}. Bitte zuerst erzeugen.`);
  }
}

async function startServer() {
  const serverProcess = spawn(process.execPath, ["server/chatServer.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CHAT_SERVER_PORT: String(PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let ready = false;
  let startupLog = "";

  serverProcess.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    startupLog += text;
    process.stdout.write(`[server] ${text}`);
    if (!ready && text.includes("Chat-Server gestartet")) {
      ready = true;
    }
  });

  serverProcess.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(`[server-err] ${text}`);
  });

  serverProcess.on("exit", (code) => {
    if (!ready) {
      console.error(`Server hat sich vorzeitig beendet (Exit-Code ${code}).`);
    }
  });

  const timeoutMs = 5_000;
  const started = await Promise.race([
    (async () => {
      while (!ready) {
        await wait(100);
      }
      return true;
    })(),
    wait(timeoutMs, false),
  ]);

  if (!started) {
    serverProcess.kill("SIGTERM");
    throw new Error(`Server wurde nicht innerhalb von ${timeoutMs} ms gestartet. Logs: ${startupLog}`);
  }

  return serverProcess;
}

async function sendPositionCapture({ note }) {
  const photoBuffer = await fs.readFile(dummyPhotoPath);
  const formData = new FormData();
  formData.set("baurundgangId", "1");
  formData.set("note", note);
  formData.set("photo", new Blob([photoBuffer], { type: "image/jpeg" }), "dummy-foto.jpg");

  const response = await fetch(`${BASE_URL}/qs-rundgang/position-erfassen`, {
    method: "POST",
    body: formData,
  });

  const json = await response.json();
  return { statusCode: response.status, json };
}

async function validatePosition(positionId) {
  const position = await prisma.position.findUnique({
    where: { id: positionId },
    include: {
      bauteil: {
        include: {
          template: true,
        },
      },
    },
  });

  if (!position) {
    throw new Error(`Position ${positionId} konnte nicht in der Datenbank gefunden werden.`);
  }

  const validations = {
    bereichstitel: position.bereichstitel ?? null,
    bauteilTemplate: position.bauteil?.template?.name ?? null,
    bemerkungEnthaeltStandardtext:
      (() => {
        const t = position.bemerkung ?? "";
        return /S\u00E4mtliche\s+Strangabsperrungen/i.test(t) || /Strangabsperr\w+.*Entleer|Entleer\w+.*Strangabsperr/i.test(t);
      })(),
    fristGesetzt: Boolean(position.frist),
  };

  if (!validations.bereichstitel?.match(/sanitär/i) && !validations.bauteilTemplate?.match(/sanitär/i)) {
    throw new Error(`Erwarteter Bereich/Bauteil 'Sanitär' nicht gefunden. Daten: ${JSON.stringify(validations)}`);
  }

  if (!validations.bemerkungEnthaeltStandardtext) {
    throw new Error("Standardtext ('Sämtliche Strangabsperrungen ... Entleerventile') wurde nicht in der Position gespeichert.");
  }

  if (!validations.fristGesetzt) {
    throw new Error("Für die Position wurde keine Frist gesetzt.");
  }

  return validations;
}

async function run() {
  await ensureDummyPhotoExists();

  const server = await startServer();

  try {
    // Testfall A
    const resultA = await sendPositionCapture({ note: "Strangabsperrventile ohne Entleerung" });
    logSection("Testfall A Antwort", resultA);

    if ((resultA.json?.status ?? "") !== "SUCCESS") {
      throw new Error(`Testfall A: Unerwarteter Status ${resultA.json?.status}`);
    }

    const positionId = resultA.json?.context?.positionId;
    if (!positionId) {
      throw new Error("Testfall A: positionId fehlt in der Antwort.");
    }

    const validationA = await validatePosition(positionId);
    logSection("Testfall A Validierung", { positionId, ...validationA });

    // Testfall B
    const resultB = await sendPositionCapture({ note: "Problem bei Trennwand" });
    logSection("Testfall B Antwort", resultB);

    if ((resultB.json?.status ?? "") !== "NEEDS_INPUT") {
      throw new Error(`Testfall B: Erwarteter Status 'NEEDS_INPUT', erhalten: ${resultB.json?.status}`);
    }

    const options = Array.isArray(resultB.json?.options) ? resultB.json.options : [];
    const hasElektro = options.some((label) => label.match(/elektro/i));
    const hasInnenausbau = options.some((label) => label.match(/innenausbau/i));

    if (!hasElektro || !hasInnenausbau) {
      throw new Error(
        `Testfall B: Erwartete Optionen 'Elektro' und 'Übriger Innenausbau' nicht gefunden. Optionen: ${JSON.stringify(options)}`,
      );
    }

    logSection("Testfall B Validierung", { options });
  } finally {
    await prisma.$disconnect();
    server.kill("SIGTERM");
    await once(server, "exit");
  }
}

run().catch((error) => {
  console.error("\n❌ Tests fehlgeschlagen:", error);
  process.exitCode = 1;
});
