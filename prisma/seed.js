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
