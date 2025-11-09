import process from "node:process";

import { PrismaClient } from "@prisma/client";

import {
  instantiateBauteilFromTemplate,
  summarizeInstantiation,
} from "../src/agent/bauteil/instantiateFromTemplate.js";

const prisma = new PrismaClient();

function printUsage() {
  console.log(`Usage:
  node scripts/instantiateTemplates.js --bauteil <id> [--bauteil <id> ...]
  node scripts/instantiateTemplates.js --baurundgang <id> [--baurundgang <id> ...]

Options:
  --force        Re-instantiates even if Bereiche already exist.
  --help, -h     Show this help message.
`);
}

function collectValue(args, index, label) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${label}`);
  }
  return { value, nextIndex: index + 1 };
}

function parseIds(rawIds, label) {
  return rawIds.map((value) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid ${label} id: ${value}`);
    }
    return parsed;
  });
}

function parseArgs(argv) {
  const args = [...argv];
  const bauteilIds = [];
  const baurundgangIds = [];
  let force = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      return { help: true, bauteilIds, baurundgangIds, force };
    }

    if (arg === "--force") {
      force = true;
      continue;
    }

    if (arg === "--bauteil") {
      const { value, nextIndex } = collectValue(args, i, "--bauteil");
      bauteilIds.push(value);
      i = nextIndex;
      continue;
    }

    if (arg.startsWith("--bauteil=")) {
      bauteilIds.push(arg.split("=")[1]);
      continue;
    }

    if (arg === "--baurundgang") {
      const { value, nextIndex } = collectValue(args, i, "--baurundgang");
      baurundgangIds.push(value);
      i = nextIndex;
      continue;
    }

    if (arg.startsWith("--baurundgang=")) {
      baurundgangIds.push(arg.split("=")[1]);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { bauteilIds, baurundgangIds, force };
}

async function collectBauteile({ bauteilIds, baurundgangIds }) {
  const ids = new Set(parseIds(bauteilIds, "bauteil"));
  const baurundgangIdInts = parseIds(baurundgangIds, "baurundgang");

  for (const baurundgangId of baurundgangIdInts) {
    const found = await prisma.bauteil.findMany({
      where: { baurundgangId },
      select: { id: true },
      orderBy: { id: "asc" },
    });

    if (found.length === 0) {
      console.warn(`No Bauteile found for Baurundgang ${baurundgangId}`);
    }

    for (const entry of found) {
      ids.add(entry.id);
    }
  }

  return [...ids];
}

async function main() {
  const argv = process.argv.slice(2);
  let parsed;

  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (parsed.help) {
    printUsage();
    return;
  }

  if (parsed.bauteilIds.length === 0 && parsed.baurundgangIds.length === 0) {
    console.error("No targets specified. Use --bauteil or --baurundgang.");
    printUsage();
    process.exitCode = 1;
    return;
  }

  const targets = await collectBauteile(parsed);

  if (targets.length === 0) {
    console.warn("Nothing to instantiate.");
    return;
  }

  const results = [];
  for (const bauteilId of targets) {
    const outcome = await instantiateBauteilFromTemplate(prisma, bauteilId, {
      force: parsed.force,
    });
    results.push(outcome);
    console.log(
      `Bauteil ${bauteilId}: ${outcome.status}${
        outcome.reason ? ` (${outcome.reason})` : ""
      }`
    );
  }

  const summary = summarizeInstantiation(results);
  console.log(
    `Summary: created=${summary.created}, skipped=${summary.skipped}, bereiche=${summary.bereiche}, kapitel=${summary.kapitel}, texte=${summary.texte}`
  );
}

main()
  .catch((error) => {
    console.error("Instantiation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
