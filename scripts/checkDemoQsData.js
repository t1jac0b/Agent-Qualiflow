import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[CheckDemoQS] Prfe Demo-QS-Daten fr 'Testkunde Alpha AG'...");

  const kunde = await prisma.kunde.findFirst({
    where: { name: "Testkunde Alpha AG" },
    include: { objekte: true },
  });

  if (!kunde) {
    throw new Error("Demo-Kunde 'Testkunde Alpha AG' nicht gefunden. Seed bereits ausgefhrt?");
  }

  const objekt =
    kunde.objekte.find((o) => o.bezeichnung === "Wohnberbauung Alpha") ?? kunde.objekte[0];

  if (!objekt) {
    throw new Error("Kein Objekt fr Demo-Kunde gefunden.");
  }

  const reports = await prisma.qSReport.findMany({
    where: { objektId: objekt.id },
    include: { positionen: true, baurundgang: { include: { typ: true } } },
  });

  if (!reports.length) {
    throw new Error("Keine QSReports fr Demo-Objekt gefunden.");
  }

  const totalPositions = reports.reduce((sum, r) => sum + (r.positionen?.length ?? 0), 0);
  const withAtLeastTwoPositions = reports.filter((r) => (r.positionen?.length ?? 0) >= 2).length;

  if (withAtLeastTwoPositions < 3) {
    throw new Error(
      `[CheckDemoQS] Erwartet mindestens 3 QSReports mit  2 Positionen, gefunden ${withAtLeastTwoPositions}.`,
    );
  }

  console.log(
    `[CheckDemoQS] OK  ${reports.length} QSReports mit insgesamt ${totalPositions} Positionen fr Objekt '${objekt.bezeichnung}' (ID ${objekt.id}).`,
  );

  console.log("[CheckDemoQS] Demo-Objekt-ID:", objekt.id);
}

main()
  .catch(async (error) => {
    console.error("[CheckDemoQS] FAILED:", error?.message ?? error);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
