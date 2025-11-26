import { PrismaClient } from "@prisma/client";
import {
  projektleiterData,
  kontaktData,
  objekttypData,
  baurundgangTypData,
  bauteilTemplateData,
  materialisierungTemplateData,
  bauteilRisikoData,
  rueckmeldungstypData,
  dummyKundenData,
} from "./seedData.js";

const prisma = new PrismaClient();

function ensurePlainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

async function ensureDefaultRecipientsForAllKunden() {
  const defaultKontakt = await prisma.kontakt.findFirst({ where: { email: "support@qualicasa.ch" } });
  const defaultPL = await prisma.projektleiter.findFirst({ orderBy: { id: "asc" } });

  const kunden = await prisma.kunde.findMany({ select: { id: true, kontaktId: true, projektleiterId: true } });
  for (const k of kunden) {
    const data = {};
    if (!k.kontaktId && defaultKontakt) data.kontakt = { connect: { id: defaultKontakt.id } };
    if (!k.projektleiterId && defaultPL) data.projektleiter = { connect: { id: defaultPL.id } };
    if (Object.keys(data).length) {
      await prisma.kunde.update({ where: { id: k.id }, data });
    }
  }

  const objekte = await prisma.objekt.findMany({ select: { id: true, kontaktId: true, projektleiterId: true } });
  for (const o of objekte) {
    const data = {};
    if (!o.kontaktId && defaultKontakt) data.kontakt = { connect: { id: defaultKontakt.id } };
    if (!o.projektleiterId && defaultPL) data.projektleiter = { connect: { id: defaultPL.id } };
    if (Object.keys(data).length) {
      await prisma.objekt.update({ where: { id: o.id }, data });
    }
  }
}

function svgDataUri(label = "Demo", color = "#e94e44") {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260">` +
    `<rect x="0" y="0" width="400" height="260" fill="${color}"/>` +
    `<text x="200" y="130" fill="#fff" font-size="28" text-anchor="middle" alignment-baseline="middle" font-family="Arial, Helvetica, sans-serif">${label}</text>` +
    `</svg>`;
  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

async function seedDemoQsData() {
  const kunde = await prisma.kunde.findFirst({
    where: { name: "Testkunde Alpha AG" },
    include: { objekte: true },
  });

  if (!kunde) {
    console.warn("⚠️  Demo-Kunde 'Testkunde Alpha AG' nicht gefunden – überspringe QS-Demo-Daten.");
    return;
  }

  const objekt =
    kunde.objekte.find((o) => o.bezeichnung === "Wohnüberbauung Alpha") ??
    kunde.objekte[0];

  if (!objekt) {
    console.warn("⚠️  Kein Objekt für Demo-Kunde gefunden – überspringe QS-Demo-Daten.");
    return;
  }

  const typNames = [
    "Fassadenarbeiten",
    "Flachdach / Fenstereinbauten",
    "Innenausbau Leichtbauwände, Gipserarbeiten",
  ];

  const baurundgangTypen = await prisma.baurundgangTyp.findMany({
    where: { name: { in: typNames } },
  });

  if (!baurundgangTypen.length) {
    console.warn("⚠️  Keine passenden Baurundgang-Typen für QS-Demo-Daten gefunden.");
    return;
  }

  const rueckmeldungstypen = await prisma.rueckmeldungstyp.findMany();
  const rmMain = rueckmeldungstypen[0]?.id ?? null;
  const rmAlt = rueckmeldungstypen[1]?.id ?? rmMain;

  const now = new Date();
  const addDays = (days) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  for (const typ of baurundgangTypen) {
    let baurundgang = await prisma.baurundgang.findFirst({
      where: { objektId: objekt.id, baurundgangTypId: typ.id },
    });

    if (!baurundgang) {
      baurundgang = await prisma.baurundgang.create({
        data: {
          objektId: objekt.id,
          baurundgangTypId: typ.id,
          status: "erledigt",
          datumGeplant: addDays(-30),
          datumDurchgefuehrt: addDays(-7),
          notiz: "Demo QS-Rundgang (Seed)",
        },
      });
    }

    let report = await prisma.qSReport.findUnique({ where: { baurundgangId: baurundgang.id } });
    if (!report) {
      report = await prisma.qSReport.create({
        data: {
          baurundgangId: baurundgang.id,
          objektId: objekt.id,
          kundeId: kunde.id,
          zusammenfassung: `Demo QS-Report für ${typ.name}`,
        },
      });
    }

    const existingPositions = await prisma.position.count({ where: { qsreportId: report.id } });
    if (existingPositions > 0) {
      continue;
    }

    const pos1 = await prisma.position.create({
      data: {
        qsreportId: report.id,
        positionsnummer: 1,
        bemerkung: `${typ.name}: Abdichtung prüfen`,
        frist: addDays(14),
        erledigt: false,
        rueckmeldungstypId: rmMain ?? undefined,
      },
    });

    const foto1 = await prisma.foto.create({
      data: {
        baurundgangId: baurundgang.id,
        dateiURL: svgDataUri(`${typ.name} 1`, "#e94e44"),
      },
    });
    await prisma.positionFoto.create({ data: { positionId: pos1.id, fotoId: foto1.id } });

    const pos2 = await prisma.position.create({
      data: {
        qsreportId: report.id,
        positionsnummer: 2,
        bemerkung: `${typ.name}: Detailanschluss kontrollieren`,
        frist: addDays(21),
        erledigt: true,
        erledigtAm: addDays(-1),
        rueckmeldungstypId: rmAlt ?? undefined,
      },
    });

    const foto2 = await prisma.foto.create({
      data: {
        baurundgangId: baurundgang.id,
        dateiURL: svgDataUri(`${typ.name} 2`, "#4b5563"),
      },
    });
    await prisma.positionFoto.create({ data: { positionId: pos2.id, fotoId: foto2.id } });
  }

  console.log("🌱 Demo QS-Reports, Positionen und Fotos für Testkunde Alpha AG erzeugt (falls fehlend).");
}

async function upsertByDelegate(delegate, uniqueWhere, createData, updateData) {
  const existing = await delegate.findFirst({ where: uniqueWhere });
  if (existing) {
    return delegate.update({ where: { id: existing.id }, data: updateData ?? createData });
  }
  return delegate.create({ data: createData });
}

async function seedProjektleiter() {
  for (const item of projektleiterData) {
    const data = ensurePlainObject(item);
    await upsertByDelegate(
      prisma.projektleiter,
      { email: data.email },
      data,
      {
        name: data.name,
        email: data.email,
        telefon: data.telefon,
        aktiv: data.aktiv ?? true,
      }
    );
  }
}

async function seedKontakte() {
  for (const item of kontaktData) {
    const data = ensurePlainObject(item);
    await upsertByDelegate(
      prisma.kontakt,
      { email: data.email },
      data,
      {
        name: data.name,
        email: data.email,
        aktiv: data.aktiv ?? true,
      }
    );
  }
}

async function seedObjekttypen() {
  for (const item of objekttypData) {
    const data = ensurePlainObject(item);
    await upsertByDelegate(
      prisma.objekttyp,
      { bezeichnung: data.bezeichnung },
      data,
      { bezeichnung: data.bezeichnung, aktiv: data.aktiv ?? true }
    );
  }
}

async function seedBaurundgangTypen() {
  for (const item of baurundgangTypData) {
    const data = ensurePlainObject(item);
    await upsertByDelegate(
      prisma.baurundgangTyp,
      { nummer: data.nummer },
      data,
      {
        nummer: data.nummer,
        name: data.name,
        reihenfolge: data.reihenfolge,
        aktiv: data.aktiv ?? true,
      }
    );
  }
}

async function seedBauteilTemplates() {
  for (const template of bauteilTemplateData) {
    const data = ensurePlainObject(template);
    await upsertByDelegate(
      prisma.bauteilTemplate,
      { name: data.name },
      data,
      {
        name: data.name,
        reihenfolge: data.reihenfolge,
        aktiv: data.aktiv ?? true,
      }
    );
  }
}

async function seedMaterialisierungTemplates() {
  for (const group of materialisierungTemplateData) {
    const groupData = ensurePlainObject(group);
    const bauteilTemplate = await prisma.bauteilTemplate.findFirst({ where: { name: groupData.bauteilName } });

    if (!bauteilTemplate) {
      console.warn(`⚠️  Skipping Materialisierungseinträge für unbekanntes Bauteil "${groupData.bauteilName}"`);
      continue;
    }

    for (const [index, name] of groupData.materialisierungen.entries()) {
      const materialisierungData = {
        name,
        reihenfolge: index + 1,
        aktiv: true,
        bauteilTemplate: { connect: { id: bauteilTemplate.id } },
      };

      await upsertByDelegate(
        prisma.materialisierungTemplate,
        { name, bauteilTemplateId: bauteilTemplate.id },
        materialisierungData,
        materialisierungData
      );
    }
  }
}

async function seedBauteilRisiken() {
  for (const item of bauteilRisikoData) {
    const data = ensurePlainObject(item);
    await upsertByDelegate(
      prisma.bauteilRisiko,
      { name: data.name },
      data,
      {
        name: data.name,
        reihenfolge: data.reihenfolge,
        aktiv: data.aktiv ?? true,
      }
    );
  }
}

async function seedRueckmeldungstypen() {
  const allowedCodes = rueckmeldungstypData.map((i) => i.typCode);

  const disallowed = await prisma.rueckmeldungstyp.findMany({
    where: { typCode: { notIn: allowedCodes } },
    select: { id: true },
  });

  const disallowedIds = disallowed.map((x) => x.id);

  if (disallowedIds.length) {
    await prisma.position.updateMany({
      where: { rueckmeldungstypId: { in: disallowedIds } },
      data: { rueckmeldungstypId: null },
    });

    try {
      await prisma.positionRueckmeldungstyp.deleteMany({ where: { rueckmeldungstypId: { in: disallowedIds } } });
    } catch (_) {
      // ignore if join table does not exist yet
    }

    await prisma.rueckmeldungstyp.deleteMany({ where: { id: { in: disallowedIds } } });
  }

  for (const item of rueckmeldungstypData) {
    const data = ensurePlainObject(item);
    await upsertByDelegate(
      prisma.rueckmeldungstyp,
      { typCode: data.typCode },
      data,
      {
        typCode: data.typCode,
        name: data.name,
      }
    );
  }
}

async function seedDummyKunden() {
  for (const kundeItem of dummyKundenData) {
    const data = ensurePlainObject(kundeItem);

    const kontakt = await prisma.kontakt.findFirst({ where: { email: data.kontaktEmail } });
    const projektleiter = await prisma.projektleiter.findFirst({ where: { name: data.projektleiterName } });

    const kunde = await upsertByDelegate(
      prisma.kunde,
      { name: data.name },
      {
        name: data.name,
        adresse: data.adresse,
        plz: data.plz,
        ort: data.ort,
        kontakt: kontakt ? { connect: { id: kontakt.id } } : undefined,
        projektleiter: projektleiter ? { connect: { id: projektleiter.id } } : undefined,
      },
      {
        name: data.name,
        adresse: data.adresse,
        plz: data.plz,
        ort: data.ort,
        kontakt: kontakt ? { connect: { id: kontakt.id } } : undefined,
        projektleiter: projektleiter ? { connect: { id: projektleiter.id } } : undefined,
      }
    );

    if (!Array.isArray(data.objekte)) continue;

    for (const objektItem of data.objekte) {
      const objektData = ensurePlainObject(objektItem);
      const objekttyp = objektData.objekttypBezeichnung
        ? await prisma.objekttyp.findFirst({ where: { bezeichnung: objektData.objekttypBezeichnung } })
        : null;

      const existingObjekt = await prisma.objekt.findFirst({
        where: {
          kundeId: kunde.id,
          bezeichnung: objektData.bezeichnung,
        },
      });

      if (existingObjekt) {
        await prisma.objekt.update({
          where: { id: existingObjekt.id },
          data: {
            adresse: objektData.adresse,
            plz: objektData.plz,
            ort: objektData.ort,
            objekttyp: objekttyp ? { connect: { id: objekttyp.id } } : undefined,
          },
        });
      } else {
        await prisma.objekt.create({
          data: {
            bezeichnung: objektData.bezeichnung,
            adresse: objektData.adresse,
            plz: objektData.plz,
            ort: objektData.ort,
            kunde: { connect: { id: kunde.id } },
            objekttyp: objekttyp ? { connect: { id: objekttyp.id } } : undefined,
          },
        });
      }
    }
  }
}

async function main() {
  console.log("🌱 Seeding reference data...");
  await seedProjektleiter();
  await seedKontakte();
  await seedObjekttypen();
  await seedBaurundgangTypen();
  await seedBauteilTemplates();
  await seedMaterialisierungTemplates();
  await seedBauteilRisiken();
  await seedRueckmeldungstypen();
  await seedDummyKunden();
  await ensureDefaultRecipientsForAllKunden();
  await seedDemoQsData();
  console.log("✅ Seeding completed.");
}

main()
  .catch((error) => {
    console.error("❌ Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
