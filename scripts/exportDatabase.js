import fs from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MODEL_QUERIES = [
  { key: "reportRequests", query: () => prisma.reportRequest.findMany() },
  { key: "projektleiter", query: () => prisma.projektleiter.findMany() },
  { key: "kontakte", query: () => prisma.kontakt.findMany() },
  { key: "objekttypen", query: () => prisma.objekttyp.findMany() },
  { key: "kunden", query: () => prisma.kunde.findMany() },
  { key: "verteiler", query: () => prisma.verteiler.findMany() },
  { key: "objekte", query: () => prisma.objekt.findMany() },
  { key: "baurundgangTypen", query: () => prisma.baurundgangTyp.findMany() },
  { key: "baurundgaenge", query: () => prisma.baurundgang.findMany() },
  { key: "pruefpunkte", query: () => prisma.pruefpunkt.findMany() },
  { key: "bauteilTemplates", query: () => prisma.bauteilTemplate.findMany() },
  {
    key: "materialisierungTemplates",
    query: () => prisma.materialisierungTemplate.findMany(),
  },
  { key: "bereichKapitelTemplates", query: () => prisma.bereichKapitelTemplate.findMany() },
  {
    key: "bereichKapitelTextTemplates",
    query: () => prisma.bereichKapitelTextTemplate.findMany(),
  },
  { key: "bauteilRisiken", query: () => prisma.bauteilRisiko.findMany() },
  { key: "bauteile", query: () => prisma.bauteil.findMany() },
  { key: "bereichKapitel", query: () => prisma.bereichKapitel.findMany() },
  { key: "bereichKapitelTexte", query: () => prisma.bereichKapitelText.findMany() },
  { key: "fotos", query: () => prisma.foto.findMany() },
  { key: "rueckmeldungstypen", query: () => prisma.rueckmeldungstyp.findMany() },
  { key: "qsReports", query: () => prisma.qSReport.findMany() },
  {
    key: "qsReportTeilnehmer",
    query: () => prisma.qSReportTeilnehmer.findMany(),
  },
  { key: "positionen", query: () => prisma.position.findMany() },
  { key: "positionFotos", query: () => prisma.positionFoto.findMany() },
];

async function resolveOutputPath(argv) {
  const flagIndex = argv.indexOf("--out");
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return path.resolve(argv[flagIndex + 1]);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve("data", `db-export-${timestamp}.json`);
}

async function main() {
  const outputPath = await resolveOutputPath(process.argv.slice(2));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const exportPayload = {};

  for (const { key, query } of MODEL_QUERIES) {
    exportPayload[key] = await query();
  }

  await fs.writeFile(outputPath, JSON.stringify(exportPayload, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        status: "SUCCESS",
        message: "Datenbankexport abgeschlossen.",
        outputPath,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ status: "ERROR", message: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
