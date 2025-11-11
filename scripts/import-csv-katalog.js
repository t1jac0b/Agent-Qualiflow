#!/usr/bin/env node
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function usage() {
  console.log("Usage: node scripts/import-csv-katalog.js [--file data/qs_katalog.csv]");
}

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

const csvPath = getArg("--file", "data/qs_katalog.csv");

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        cur += '"';
        i += 1; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.replace(/\r?\n/g, "\n").trim());
}

async function clearTemplates() {
  await prisma.$transaction([
    prisma.bereichKapitelTextTemplate.deleteMany(),
    prisma.bereichKapitelTemplate.deleteMany(),
  ]);
}

async function importCsvRows(rows) {
  let createdKapitel = 0;
  let createdTexte = 0;
  const cacheKapitel = new Map(); // key: `${bauteilId}::${kapitelName}` -> kapitelTemplateId

  for (const [index, row] of rows.entries()) {
    // Expect at least 5 columns: Position, BKP, Bauteil, Bereichskapitel, Bereichstext
    const cols = parseCsvLine(row);
    if (cols.length < 5) continue;

    const position = cols[0]?.trim();
    const bkp = cols[1]?.trim() || null;
    const bauteilName = cols[2]?.trim();
    const kapitelName = cols[3]?.trim();
    // Allow commas/newlines inside text
    const bereichstext = cols.slice(4).join(",").trim();

    if (!bauteilName || !kapitelName || !bereichstext) continue;

    const bauteilTemplate = await prisma.bauteilTemplate.findFirst({
      where: { name: { equals: bauteilName, mode: "insensitive" } },
    });
    if (!bauteilTemplate) {
      console.warn(`⚠️  Unbekanntes BauteilTemplate '${bauteilName}' bei Position ${position ?? index + 1}`);
      continue;
    }

    const kapitelKey = `${bauteilTemplate.id}::${kapitelName.toLowerCase()}`;
    let kapitelTemplateId = cacheKapitel.get(kapitelKey) || null;

    if (!kapitelTemplateId) {
      let kapitelTemplate = await prisma.bereichKapitelTemplate.findFirst({
        where: {
          bauteilTemplateId: bauteilTemplate.id,
          name: { equals: kapitelName, mode: "insensitive" },
        },
      });

      if (!kapitelTemplate) {
        kapitelTemplate = await prisma.bereichKapitelTemplate.create({
          data: {
            name: kapitelName,
            bkp: bkp || null,
            bauteilTemplate: { connect: { id: bauteilTemplate.id } },
          },
        });
        createdKapitel += 1;
      } else if (bkp && kapitelTemplate.bkp !== bkp) {
        kapitelTemplate = await prisma.bereichKapitelTemplate.update({
          where: { id: kapitelTemplate.id },
          data: { bkp },
        });
      }

      kapitelTemplateId = kapitelTemplate.id;
      cacheKapitel.set(kapitelKey, kapitelTemplateId);
    }

    await prisma.bereichKapitelTextTemplate.create({
      data: {
        text: bereichstext,
        kapitelTemplate: { connect: { id: kapitelTemplateId } },
      },
    });
    createdTexte += 1;
  }

  console.log(`Kapitel erstellt/aktualisiert: ${createdKapitel}`);
  console.log(`Texte erstellt: ${createdTexte}`);
}

async function main() {
  const raw = await readFile(csvPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    console.error("CSV ist leer");
    process.exit(1);
  }

  // remove header
  const [, ...dataRows] = lines;

  await clearTemplates();
  await importCsvRows(dataRows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
