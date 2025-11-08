import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Minimal Stammdaten
  const projektleiter = await prisma.projektleiter.create({
    data: { name: "PL Müller", email: "pl.mueller@example.com", aktiv: true },
  });

  const kontakt = await prisma.kontakt.create({
    data: { name: "Max Beispiel", email: "max@example.com", aktiv: true },
  });

  const objekttyp = await prisma.objekttyp.create({
    data: { bezeichnung: "Wohnhaus", aktiv: true },
  });

  const kunde = await prisma.kunde.create({
    data: {
      name: "Kunde AG",
      adresse: "Musterstrasse 1",
      plz: "8000",
      ort: "Zürich",
      status: "aktiv",
      kontakt: { connect: { id: kontakt.id } },
      projektleiter: { connect: { id: projektleiter.id } },
    },
  });

  const objekt = await prisma.objekt.create({
    data: {
      kunde: { connect: { id: kunde.id } },
      kontakt: { connect: { id: kontakt.id } },
      projektleiter: { connect: { id: projektleiter.id } },
      objekttyp: { connect: { id: objekttyp.id } },
      bezeichnung: "Objekt A",
      adresse: "Bauweg 2",
      plz: "8001",
      ort: "Zürich",
      status: true,
    },
  });

  const typ = await prisma.baurundgangTyp.create({
    data: { nummer: 1, name: "Initial", aktiv: true },
  });

  const baurundgang = await prisma.baurundgang.create({
    data: {
      objekt: { connect: { id: objekt.id } },
      typ: { connect: { id: typ.id } },
      status: "geplant",
    },
  });

  const qsReport = await prisma.qSReport.create({
    data: {
      baurundgang: { connect: { id: baurundgang.id } },
      objekt: { connect: { id: objekt.id } },
      kunde: { connect: { id: kunde.id } },
      projektleiter: { connect: { id: projektleiter.id } },
      kontakt: { connect: { id: kontakt.id } },
      objekttyp: { connect: { id: objekttyp.id } },
      zusammenfassung: "Erster QS-Report",
    },
  });

  const risiko = await prisma.bauteilRisiko.create({ data: { name: "Feuchtigkeit", aktiv: true } });
  const tpl = await prisma.bauteilTemplate.create({ data: { name: "Fassade", aktiv: true } });
  const matTpl = await prisma.materialisierungTemplate.create({ data: { name: "Putz", bauteilTemplate: { connect: { id: tpl.id } }, aktiv: true } });

  const bauteil = await prisma.bauteil.create({
    data: {
      baurundgang: { connect: { id: baurundgang.id } },
      template: { connect: { id: tpl.id } },
      materialisierung: { connect: { id: matTpl.id } },
      risiko: { connect: { id: risiko.id } },
    },
  });

  const bereich = await prisma.bereich.create({
    data: { bauteil: { connect: { id: bauteil.id } }, name: "Nordseite" },
  });

  const rueckmeldungstyp = await prisma.rueckmeldungstyp.create({
    data: { typCode: "R", name: "Mangel" },
  });

  const position = await prisma.position.create({
    data: {
      qsreport: { connect: { id: qsReport.id } },
      bauteil: { connect: { id: bauteil.id } },
      bereich: { connect: { id: bereich.id } },
      rueckmeldungstyp: { connect: { id: rueckmeldungstyp.id } },
      positionsnummer: 1,
      bemerkung: "Abplatzungen vorhanden",
    },
  });

  const foto = await prisma.foto.create({
    data: {
      baurundgang: { connect: { id: baurundgang.id } },
      bereich: { connect: { id: bereich.id } },
      dateiURL: "file://dummy.jpg",
    },
  });

  await prisma.positionFoto.create({ data: { positionId: position.id, fotoId: foto.id } });

  console.log("Seed done:", { qsReportId: qsReport.id });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
