import process from "node:process";

import { PrismaClient } from "@prisma/client";

import {
  instantiateBauteilFromTemplate,
  summarizeInstantiation,
} from "../src/agent/bauteil/instantiateFromTemplate.js";

const prisma = new PrismaClient();

function printUsage() {
  console.log(`Usage:
  node scripts/backfillBauteile.js [--bauteil <id> ...] [--baurundgang <id> ...]

Options:
  --force        Re-instantiates even if Bereiche already exist (deletes first).
  --dry-run      Show what would be backfilled without writing changes.
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

function parseIds(raw, label) {
  return raw.map((value) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid ${label} id: ${value}`);
    }
    return parsed;
  });
}

function parseArgs(argv) {
  const bauteilIds = [];
  const baurundgangIds = [];
  let force = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }

    if (arg === "--force") {
      force = true;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--bauteil") {
      const { value, nextIndex } = collectValue(argv, i, "--bauteil");
      bauteilIds.push(value);
      i = nextIndex;
      continue;
    }

    if (arg.startsWith("--bauteil=")) {
      bauteilIds.push(arg.split("=")[1]);
      continue;
    }

    if (arg === "--baurundgang") {
      const { value, nextIndex } = collectValue(argv, i, "--baurundgang");
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

  return {
    help: false,
    force,
    dryRun,
    bauteilIds: parseIds(bauteilIds, "bauteil"),
    baurundgangIds: parseIds(baurundgangIds, "baurundgang"),
  };
}

async function resolveTargets({ bauteilIds, baurundgangIds }) {
  const ids = new Set(bauteilIds);

  if (baurundgangIds.length > 0) {
    const bauteile = await prisma.bauteil.findMany({
      where: { baurundgangId: { in: baurundgangIds } },
      select: { id: true },
    });
    for (const entry of bauteile) {
      ids.add(entry.id);
    }
  }

  if (ids.size === 0) {
    const bauteile = await prisma.bauteil.findMany({ select: { id: true } });
    for (const entry of bauteile) ids.add(entry.id);
  }

  return [...ids].sort((a, b) => a - b);
}

async function fetchBauteilState(id) {
  return prisma.bauteil.findUnique({
    where: { id },
    include: {
      template: {
        include: {
          bereichTemplates: {
            select: { id: true },
          },
        },
      },
      bereiche: { select: { id: true } },
    },
  });
}

function summarizeDryRunEntry(bauteil, force) {
  if (!bauteil) {
    return { status: "skipped", reason: "not_found" };
  }
  if (!bauteil.template) {
    return { status: "skipped", reason: "no_template" };
  }
  if ((bauteil.template.bereichTemplates?.length ?? 0) === 0) {
    return { status: "skipped", reason: "template_without_bereiche" };
  }
  if (!force && bauteil.bereiche.length > 0) {
    return { status: "skipped", reason: "already_has_bereiche" };
  }
  return { status: "would_create" };
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

  const targetIds = await resolveTargets(parsed);

  if (targetIds.length === 0) {
    console.warn("No Bauteile found.");
    return;
  }

  const results = [];

  for (const bauteilId of targetIds) {
    const bauteil = await fetchBauteilState(bauteilId);

    if (parsed.dryRun) {
      const info = summarizeDryRunEntry(bauteil, parsed.force);
      console.log(
        `Bauteil ${bauteilId}: ${info.status}${info.reason ? ` (${info.reason})` : ""}`
      );
      continue;
    }

    if (!bauteil) {
      console.warn(`Bauteil ${bauteilId} not found`);
      results.push({ status: "skipped", reason: "not_found", bauteilId });
      continue;
    }

    if (!bauteil.template) {
      console.warn(`Bauteil ${bauteilId} has no template – skipping.`);
      results.push({ status: "skipped", reason: "no_template", bauteilId });
      continue;
    }

    const templateBereiche = bauteil.template.bereichTemplates?.length ?? 0;
    if (templateBereiche === 0) {
      console.warn(`Template for Bauteil ${bauteilId} has no BereichTemplates – skipping.`);
      results.push({
        status: "skipped",
        reason: "template_without_bereiche",
        bauteilId,
      });
      continue;
    }

    if (!parsed.force && bauteil.bereiche.length > 0) {
      results.push({
        status: "skipped",
        reason: "already_has_bereiche",
        bauteilId,
        created: { bereiche: 0, kapitel: 0, texte: 0 },
      });
      continue;
    }

    const result = await instantiateBauteilFromTemplate(prisma, bauteilId, {
      force: parsed.force,
    });
    results.push(result);
    console.log(`Bauteil ${bauteilId}: ${result.status}`);
  }

  if (!parsed.dryRun) {
    const summary = summarizeInstantiation(results);
    console.log(
      `Summary: created=${summary.created}, skipped=${summary.skipped}, bereiche=${summary.bereiche}, kapitel=${summary.kapitel}, texte=${summary.texte}`
    );
  }
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
