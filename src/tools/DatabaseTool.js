import { PrismaClient } from "@prisma/client";

import { attachBauteilInstantiationHook } from "../agent/bauteil/instantiateFromTemplate.js";

const prisma = globalThis.prisma ?? new PrismaClient();
attachBauteilInstantiationHook(prisma);
if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma;

export const DatabaseTool = {
  client: prisma,

  /**
   * Erstellt oder aktualisiert einen Kunden anhand des Namens.
   * Bei bestehenden Einträgen werden optionale Felder nur ergänzt (keine Überschreibung).
   */
  async ensureKunde({ name, adresse, plz, ort }) {
    if (!name) {
      throw new Error("ensureKunde: 'name' ist erforderlich.");
    }

    const existing = await prisma.kunde.findFirst({ where: { name } });
    if (existing) {
      const patch = {
        adresse: existing.adresse || adresse || undefined,
        plz: existing.plz || plz || undefined,
        ort: existing.ort || ort || undefined,
      };

      if (patch.adresse || patch.plz || patch.ort) {
        return prisma.kunde.update({ where: { id: existing.id }, data: patch });
      }
      return existing;
    }

    return prisma.kunde.create({
      data: {
        name,
        adresse: adresse || undefined,
        plz: plz || undefined,
        ort: ort || undefined,
      },
    });
  },

  /**
   * Stellt sicher, dass ein Objekttyp existiert und liefert dessen ID zurück.
   */
  async ensureObjekttyp(bezeichnung) {
    if (!bezeichnung) return null;

    const trimmed = bezeichnung.trim();
    if (!trimmed) return null;

    const existing = await prisma.objekttyp.findFirst({ where: { bezeichnung: trimmed } });
    if (existing) return existing;

    return prisma.objekttyp.create({ data: { bezeichnung: trimmed } });
  },

  /**
   * Erstellt ein Objekt für einen Kunden. Falls unter gleichem Kunden bereits
   * Objekte mit identischer Bezeichnung existieren, wird ein Zähler angehängt.
   */
  async createObjektForKunde({
    kundeId,
    bezeichnung,
    adresse,
    plz,
    ort,
    objekttypId,
    projektleiterId,
    kontaktId,
    titelbildURL,
    notiz,
    erstellungsjahr,
  }) {
    if (!kundeId) {
      throw new Error("createObjektForKunde: 'kundeId' ist erforderlich.");
    }

    const base = (bezeichnung && bezeichnung.trim()) || "Unbenanntes Objekt";
    const existingCount = await prisma.objekt.count({
      where: {
        kundeId,
        bezeichnung: {
          startsWith: base,
          mode: "insensitive",
        },
      },
    });

    const uniqueBezeichnung = existingCount === 0 ? base : `${base} #${existingCount + 1}`;

    return prisma.objekt.create({
      data: {
        kunde: { connect: { id: kundeId } },
        bezeichnung: uniqueBezeichnung,
        adresse: adresse || undefined,
        plz: plz || undefined,
        ort: ort || undefined,
        objekttyp: objekttypId ? { connect: { id: objekttypId } } : undefined,
        projektleiter: projektleiterId ? { connect: { id: projektleiterId } } : undefined,
        kontakt: kontaktId ? { connect: { id: kontaktId } } : undefined,
        titelbildURL: titelbildURL || undefined,
        notiz: notiz || undefined,
        erstellungsjahr: erstellungsjahr ?? undefined,
      },
    });
  },

  async createKunde(data) {
    return prisma.kunde.create({ data });
  },

  async createObjekt(data) {
    return prisma.objekt.create({ data });
  },

  async createBaurundgang(data) {
    return prisma.baurundgang.create({ data });
  },

  async createQSReport(data) {
    return prisma.qSReport.create({ data });
  },

  async addPosition(data) {
    return prisma.position.create({ data });
  },

  async addFoto(data) {
    return prisma.foto.create({ data });
  },

  async linkPositionFoto(positionId, fotoId) {
    return prisma.positionFoto.create({ data: { positionId, fotoId } });
  },

  async getQSReport(id) {
    return prisma.qSReport.findUnique({
      where: { id },
      include: {
        baurundgang: { include: { fotos: true } },
        objekt: true,
        kunde: true,
        projektleiter: true,
        kontakt: true,
        objekttyp: true,
        positionen: {
          include: {
            bauteil: true,
            bereich: true,
            rueckmeldungstyp: true,
            fotos: { include: { foto: true } },
          },
          orderBy: { positionsnummer: "asc" },
        },
        teilnehmer: { include: { kontakt: true } },
      },
    });
  },

  async disconnect() {
    await prisma.$disconnect();
  },
};
