import { PrismaClient } from "@prisma/client";

import { attachBauteilInstantiationHook } from "../agent/bauteil/instantiateFromTemplate.js";

const STANDARD_BAURUNDGANG_ORDER = [
  "Bodenplatte, Dichtigkeitsklasse",
  "Einlagen in Decke über Wohngeschoss",
  "Rohbauarbeiten, Wand- und Deckenlager",
  "Flachdach / Fenstereinbauten",
  "Vorwandinstallationen, GBT",
  "Innenausbau Leichtbauwände, Gipserarbeiten",
  "Fussbodenheizung",
  "Fassadenarbeiten",
  "Abdichtungs-und Plattenarbeiten Nasszellen",
  "Duschen und Badewannensetzen",
  "Küchenmontage",
  "Gebäudetechnik",
];

const QS_REPORT_INCLUDE = {
  baurundgang: { include: { fotos: true } },
  objekt: true,
  kunde: true,
  projektleiter: true,
  kontakt: true,
  objekttyp: true,
  positionen: {
    include: {
      bauteil: true,
      bereichKapitel: true,
      rueckmeldungstyp: true,
      fotos: { include: { foto: true } },
    },
    orderBy: { positionsnummer: "asc" },
  },
  teilnehmer: { include: { kontakt: true } },
};

const prisma = globalThis.prisma ?? new PrismaClient();
attachBauteilInstantiationHook(prisma);
if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma;

function normalizeDate(dateLike, fallback = new Date()) {
  if (!dateLike) return new Date(fallback);
  if (dateLike instanceof Date) return dateLike;
  const parsed = new Date(dateLike);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(fallback);
  }
  return parsed;
}

export const DatabaseTool = {
  client: prisma,

  async findKundeByName(name) {
    if (!name) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;

    return prisma.kunde.findFirst({
      where: {
        name: { equals: trimmed, mode: "insensitive" },
      },
    });
  },

  async updateKundeFields({ id, data }) {
    if (!id) {
      throw new Error("updateKundeFields: 'id' ist erforderlich.");
    }

    return prisma.kunde.update({ where: { id }, data });
  },

  async findObjektByName({ name, kundeId }) {
    if (!name) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;

    const where = {
      bezeichnung: { equals: trimmed, mode: "insensitive" },
    };

    if (kundeId) {
      where.kundeId = kundeId;
    }

    return prisma.objekt.findFirst({ where });
  },

  async updateObjektFields({ id, data }) {
    if (!id) {
      throw new Error("updateObjektFields: 'id' ist erforderlich.");
    }

    return prisma.objekt.update({ where: { id }, data });
  },

  async autoCreateBaurundgaengeForObjekt(objektId) {
    if (!objektId) {
      throw new Error("autoCreateBaurundgaengeForObjekt: 'objektId' ist erforderlich.");
    }

    const [types, existing] = await Promise.all([
      prisma.baurundgangTyp.findMany({
        where: { aktiv: true },
        select: { id: true, name: true },
      }),
      prisma.baurundgang.findMany({
        where: { objektId },
        select: { baurundgangTypId: true },
      }),
    ]);

    if (!types.length) {
      return { created: 0 };
    }

    const typesByName = new Map(
      types.map((typ) => [typ.name?.trim().toLowerCase() ?? "", typ]).filter(([key]) => key),
    );

    const orderedTypes = STANDARD_BAURUNDGANG_ORDER.map((name) => {
      const key = name.trim().toLowerCase();
      return typesByName.get(key) ?? null;
    }).filter((typ) => typ);

    if (!orderedTypes.length) {
      return { created: 0 };
    }

    const existingIds = new Set(existing.map((item) => item.baurundgangTypId));
    let created = 0;

    for (const typ of orderedTypes) {
      if (!typ || existingIds.has(typ.id)) {
        continue;
      }

      await prisma.baurundgang.create({
        data: {
          objekt: { connect: { id: objektId } },
          typ: { connect: { id: typ.id } },
          status: "geplant",
        },
      });
      created += 1;
    }

    return { created };
  },

  async ensureQsReportForBaurundgang({ kundeId, objektId, baurundgangId }) {
    if (!baurundgangId) {
      throw new Error("ensureQsReportForBaurundgang: 'baurundgangId' ist erforderlich.");
    }

    const existing = await prisma.qSReport.findUnique({ where: { baurundgangId } });
    if (existing) return existing;

    if (!kundeId || !objektId) {
      throw new Error(
        "ensureQsReportForBaurundgang: 'kundeId' und 'objektId' sind erforderlich, wenn kein Report existiert.",
      );
    }

    return prisma.qSReport.create({
      data: {
        baurundgang: { connect: { id: baurundgangId } },
        objekt: { connect: { id: objektId } },
        kunde: { connect: { id: kundeId } },
        zusammenfassung: "Automatisch angelegter QS-Report",
      },
    });
  },

  async listErledigteBaurundgaenge({ kundeId, objektId } = {}) {
    const where = {};
    if (objektId) {
      where.objektId = objektId;
    } else if (kundeId) {
      where.objekt = { kundeId };
    }

    where.OR = [{ status: { equals: "erledigt", mode: "insensitive" } }, { datumDurchgefuehrt: { not: null } }];

    return prisma.baurundgang.findMany({
      where,
      orderBy: { datumDurchgefuehrt: "desc" },
      select: {
        id: true,
        datumDurchgefuehrt: true,
        datumGeplant: true,
        status: true,
        notiz: true,
        typ: {
          select: { name: true },
        },
      },
    });
  },

  async listPendingRueckmeldungen({ dueBefore, maxReminderCount = 5, includeCompleted = false } = {}) {
    const now = normalizeDate(dueBefore, new Date());

    const erledigtFilter = includeCompleted
      ? {}
      : {
          OR: [{ erledigt: { not: true } }, { erledigt: null }],
        };

    return prisma.position.findMany({
      where: {
        ...erledigtFilter,
        reminderCount: { lt: maxReminderCount },
        OR: [
          { frist: { lte: now } },
          { reminderAt: { lte: now } },
          { frist: null },
        ],
      },
      orderBy: [
        { reminderSentAt: "asc" },
        { frist: "asc" },
        { id: "asc" },
      ],
      include: {
        rueckmeldungstyp: true,
        qsreport: {
          include: {
            kunde: {
              include: {
                projektleiter: true,
                kontakt: true,
              },
            },
            kontakt: true,
            projektleiter: true,
            objekt: {
              include: {
                kontakt: true,
                projektleiter: true,
              },
            },
            baurundgang: {
              include: { typ: true },
            },
          },
        },
        reminders: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });
  },

  async schedulePositionReminder({ positionId, channel = "email", scheduledFor, payload = null, status = "pending" }) {
    if (!positionId) {
      throw new Error("schedulePositionReminder: 'positionId' ist erforderlich.");
    }

    const scheduled = normalizeDate(scheduledFor, new Date());

    return prisma.$transaction(async (tx) => {
      const reminder = await tx.positionReminder.create({
        data: {
          positionId,
          channel,
          status,
          scheduledFor: scheduled,
          payload,
        },
      });

      await tx.position.update({
        where: { id: positionId },
        data: {
          reminderChannel: channel,
          reminderAt: scheduled,
        },
      });

      return reminder;
    });
  },

  async recordReminderDispatch({ positionId, channel = "email", payload = null, sentAt, nextReminderAt, status = "sent" }) {
    if (!positionId) {
      throw new Error("recordReminderDispatch: 'positionId' ist erforderlich.");
    }

    const sent = normalizeDate(sentAt, new Date());
    const hasNext = typeof nextReminderAt !== "undefined";
    const nextReminder = hasNext ? (nextReminderAt === null ? null : normalizeDate(nextReminderAt, null)) : undefined;

    return prisma.$transaction(async (tx) => {
      const reminder = await tx.positionReminder.create({
        data: {
          positionId,
          channel,
          status,
          scheduledFor: sent,
          sentAt: status === "sent" ? sent : null,
          payload,
        },
      });

      const updateData = {
        reminderChannel: channel,
      };

      if (status === "sent") {
        updateData.reminderSentAt = sent;
        updateData.reminderCount = { increment: 1 };
      }

      if (hasNext) {
        updateData.reminderAt = nextReminder ?? null;
      }

      await tx.position.update({
        where: { id: positionId },
        data: updateData,
      });

      return reminder;
    });
  },

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
   * Sucht oder erstellt einen Projektleiter anhand des Namens.
   * Ergänzt fehlende Kontaktinformationen ohne bestehende Werte zu überschreiben.
   */
  async ensureProjektleiter({ name, email, telefon } = {}) {
    if (!name) {
      throw new Error("ensureProjektleiter: 'name' ist erforderlich.");
    }

    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("ensureProjektleiter: 'name' darf nicht leer sein.");
    }

    const normalizedEmail = email ? email.trim().toLowerCase() : undefined;
    const normalizedTelefon = telefon ? telefon.trim() : undefined;

    const existing = await prisma.projektleiter.findFirst({
      where: { name: { equals: trimmed, mode: "insensitive" } },
    });

    if (existing) {
      const patch = {
        email: existing.email || normalizedEmail || undefined,
        telefon: existing.telefon || normalizedTelefon || undefined,
      };

      if (patch.email || patch.telefon) {
        return prisma.projektleiter.update({ where: { id: existing.id }, data: patch });
      }

      return existing;
    }

    return prisma.projektleiter.create({
      data: {
        name: trimmed,
        email: normalizedEmail,
        telefon: normalizedTelefon,
      },
    });
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

    const objekt = await prisma.objekt.create({
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

    await this.autoCreateBaurundgaengeForObjekt(objekt.id);
    return objekt;
  },

  async createKunde(data) {
    return prisma.kunde.create({ data });
  },

  async createObjekt(data) {
    const objekt = await prisma.objekt.create({ data });
    await this.autoCreateBaurundgaengeForObjekt(objekt.id);
    return objekt;
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
      include: QS_REPORT_INCLUDE,
    });
  },

  async getQSReportByBaurundgang(baurundgangId) {
    if (!baurundgangId) {
      throw new Error("getQSReportByBaurundgang: 'baurundgangId' ist erforderlich.");
    }

    return prisma.qSReport.findUnique({
      where: { baurundgangId },
      include: QS_REPORT_INCLUDE,
    });
  },

  async listKunden() {
    return prisma.kunde.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
      },
    });
  },

  async listObjekteByKunde(kundeId) {
    if (!kundeId) {
      throw new Error("listObjekteByKunde: 'kundeId' ist erforderlich.");
    }

    return prisma.objekt.findMany({
      where: { kundeId },
      orderBy: { bezeichnung: "asc" },
      select: {
        id: true,
        bezeichnung: true,
      },
    });
  },

  async listBaurundgaengeByObjekt(objektId) {
    if (!objektId) {
      throw new Error("listBaurundgaengeByObjekt: 'objektId' ist erforderlich.");
    }

    return prisma.baurundgang.findMany({
      where: { objektId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        status: true,
        datumGeplant: true,
        datumDurchgefuehrt: true,
        notiz: true,
        qsReport: {
          select: {
            id: true,
          },
        },
        typ: {
          select: {
            id: true,
            nummer: true,
            name: true,
          },
        },
      },
    });
  },

  async listPruefpunkteByBaurundgang(baurundgangId) {
    if (!baurundgangId) {
      throw new Error("listPruefpunkteByBaurundgang: 'baurundgangId' ist erforderlich.");
    }

    return prisma.pruefpunkt.findMany({
      where: { baurundgangId },
      orderBy: [
        { reihenfolge: "asc" },
        { id: "asc" },
      ],
      select: {
        id: true,
        bezeichnung: true,
        erledigt: true,
        notiz: true,
        reihenfolge: true,
      },
    });
  },

  async listBauteileByBaurundgang(baurundgangId) {
    if (!baurundgangId) {
      throw new Error("listBauteileByBaurundgang: 'baurundgangId' ist erforderlich.");
    }

    return prisma.bauteil.findMany({
      where: { baurundgangId },
      include: {
        template: true,
      },
      orderBy: { reihenfolge: "asc" },
    });
  },

  async listBauteilTemplates() {
    return prisma.bauteilTemplate.findMany({
      where: { aktiv: true },
      orderBy: { reihenfolge: "asc" },
      select: {
        id: true,
        name: true,
        reihenfolge: true,
        kapitelTemplates: {
          where: { aktiv: undefined },
        },
      },
    });
  },

  async listKapitelTemplatesByBauteilTemplate(bauteilTemplateId) {
    if (!bauteilTemplateId) {
      throw new Error("listKapitelTemplatesByBauteilTemplate: 'bauteilTemplateId' ist erforderlich.");
    }

    return prisma.bereichKapitelTemplate.findMany({
      where: { bauteilTemplateId },
      orderBy: { reihenfolge: "asc" },
      select: {
        id: true,
        name: true,
        reihenfolge: true,
      },
    });
  },

  async listRueckmeldungstypen() {
    return prisma.rueckmeldungstyp.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        typCode: true,
      },
    });
  },

  async summarizeRueckmeldungen({ baurundgangId }) {
    if (!baurundgangId) {
      throw new Error("summarizeRueckmeldungen: 'baurundgangId' ist erforderlich.");
    }

    const positions = await prisma.position.findMany({
      where: {
        qsreport: { baurundgangId },
      },
      select: {
        id: true,
        erledigt: true,
        rueckmeldungstyp: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!positions.length) {
      return [];
    }

    const summary = new Map();

    for (const position of positions) {
      const rueckmeldung = position.rueckmeldungstyp?.name ?? "Unbekannt";
      const bucket = summary.get(rueckmeldung) ?? {
        rueckmeldung,
        offen: 0,
        erledigt: 0,
        gesamt: 0,
      };

      bucket.gesamt += 1;
      if (position.erledigt) {
        bucket.erledigt += 1;
      } else {
        bucket.offen += 1;
      }

      summary.set(rueckmeldung, bucket);
    }

    return Array.from(summary.values()).sort((a, b) => {
      if (a.offen === b.offen) {
        return b.gesamt - a.gesamt;
      }
      return b.offen - a.offen;
    });
  },

  async ensureBauteilForTemplate({ baurundgangId, bauteilTemplateId }) {
    if (!baurundgangId || !bauteilTemplateId) {
      throw new Error("ensureBauteilForTemplate: 'baurundgangId' und 'bauteilTemplateId' sind erforderlich.");
    }

    const existing = await prisma.bauteil.findFirst({
      where: { baurundgangId, bauteilTemplateId },
    });

    if (existing) {
      return existing;
    }

    const reihenfolge = (await prisma.bauteil.count({ where: { baurundgangId } })) + 1;

    return prisma.bauteil.create({
      data: {
        baurundgang: { connect: { id: baurundgangId } },
        template: { connect: { id: bauteilTemplateId } },
        reihenfolge,
      },
    });
  },

  async ensureKapitelForBauteil({ bauteilId, kapitelTemplateId }) {
    if (!bauteilId || !kapitelTemplateId) {
      throw new Error("ensureKapitelForBauteil: 'bauteilId' und 'kapitelTemplateId' sind erforderlich.");
    }

    const existing = await prisma.bereichKapitel.findFirst({
      where: { bauteilId, templateId: kapitelTemplateId },
      include: { texte: true },
    });

    if (existing) {
      return existing;
    }

    return prisma.bereichKapitel.create({
      data: {
        bauteil: { connect: { id: bauteilId } },
        name: `Kapitel ${kapitelTemplateId}`,
      },
    });
  },

  async createPositionWithDefaults({
    qsreportId,
    bauteilId,
    bereichKapitelId,
    rueckmeldungstypId,
    bemerkung,
    frist,
  }) {
    if (!qsreportId) {
      throw new Error("createPositionWithDefaults: 'qsreportId' ist erforderlich.");
    }

    const positionsnummer =
      (await prisma.position.count({ where: { qsreportId } })) + 1;

    return prisma.position.create({
      data: {
        qsreport: { connect: { id: qsreportId } },
        bauteil: bauteilId ? { connect: { id: bauteilId } } : undefined,
        bereichKapitel: bereichKapitelId ? { connect: { id: bereichKapitelId } } : undefined,
        rueckmeldungstyp: rueckmeldungstypId ? { connect: { id: rueckmeldungstypId } } : undefined,
        bemerkung: bemerkung || undefined,
        frist: frist || undefined,
        positionsnummer,
      },
    });
  },

  async disconnect() {
    await prisma.$disconnect();
  },
};
