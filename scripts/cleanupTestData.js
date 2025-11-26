import process from "node:process";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DELETE_OPERATIONS = [
  { label: "PositionFoto", action: () => prisma.positionFoto.deleteMany() },
  { label: "Position", action: () => prisma.position.deleteMany() },
  { label: "QSReportTeilnehmer", action: () => prisma.qSReportTeilnehmer.deleteMany() },
  { label: "QSReport", action: () => prisma.qSReport.deleteMany() },
  { label: "Foto", action: () => prisma.foto.deleteMany() },
  { label: "Pruefpunkt", action: () => prisma.pruefpunkt.deleteMany() },
  { label: "BereichKapitelText", action: () => prisma.bereichKapitelText.deleteMany() },
  { label: "BereichKapitel", action: () => prisma.bereichKapitel.deleteMany() },
  { label: "Bauteil", action: () => prisma.bauteil.deleteMany() },
  { label: "Baurundgang", action: () => prisma.baurundgang.deleteMany() },
  { label: "Verteiler", action: () => prisma.verteiler.deleteMany() },
  { label: "Objekt", action: () => prisma.objekt.deleteMany() },
  { label: "Kunde", action: () => prisma.kunde.deleteMany() },
];

const OPTIONAL_OPERATIONS = [
  {
    label: "Kontakt (verwaist)",
    action: () => prisma.kontakt.deleteMany({ where: { kunden: { none: {} }, objekte: { none: {} }, qsReports: { none: {} } } }),
  },
  {
    label: "Projektleiter (verwaist)",
    action: () => prisma.projektleiter.deleteMany({ where: { kunden: { none: {} }, objekte: { none: {} }, qsReports: { none: {} } } }),
  },
];

function formatCount(label, count) {
  return `${label.padEnd(22)} ${count.toString().padStart(6)} gelöscht`;
}

async function main() {
  const force = process.argv.includes("--force");
  if (!force) {
    console.log("⚠️  Sicherheitshinweis: Dieser Vorgang löscht sämtliche Kunden, Objekte und Baurundgänge.");
    console.log("    Bitte führe das Script mit '--force' aus, wenn du fortfahren möchtest.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("🔄 Starte Bereinigung der Testdaten ...\n");

  const results = [];
  for (const { label, action } of DELETE_OPERATIONS) {
    const { count } = await action();
    results.push({ label, count });
  }

  console.log("✅ Kernobjekte entfernt:\n");
  for (const entry of results) {
    console.log(`  ${formatCount(entry.label, entry.count)}`);
  }

  const optionalResults = [];
  for (const { label, action } of OPTIONAL_OPERATIONS) {
    const { count } = await action();
    optionalResults.push({ label, count });
  }

  if (optionalResults.some((item) => item.count > 0)) {
    console.log("\nℹ️  Zusätzlich entfernte Einträge:\n");
    for (const entry of optionalResults) {
      if (entry.count > 0) {
        console.log(`  ${formatCount(entry.label, entry.count)}`);
      }
    }
  }

  console.log("\n🎉 Bereinigung abgeschlossen. Du kannst jetzt mit echten Kundendaten weiterarbeiten.");
}

main()
  .catch((error) => {
    console.error("❌ Fehler beim Bereinigen der Testdaten:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
