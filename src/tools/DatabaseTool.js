import { PrismaClient } from "@prisma/client";

const prisma = globalThis.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma;

export const DatabaseTool = {
  client: prisma,

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
