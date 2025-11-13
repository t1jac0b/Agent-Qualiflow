import { DatabaseTool as LegacyDatabaseTool } from "../../tools/DatabaseTool.js";
import { instantiateBauteilFromTemplate } from "../bauteil/instantiateFromTemplate.js";
import { defineTool } from "./toolTypes.js";

export const databaseTool = defineTool({
  name: "database",
  description: "Provides persistence helpers backed by Prisma/PostgreSQL.",
  metadata: { kind: "database" },
  actions: {
    findKundeByName: (payload) => LegacyDatabaseTool.findKundeByName(payload),
    ensureKunde: (payload) => LegacyDatabaseTool.ensureKunde(payload),
    ensureObjekttyp: (payload) => LegacyDatabaseTool.ensureObjekttyp(payload),
    createObjektForKunde: (payload) => LegacyDatabaseTool.createObjektForKunde(payload),
    createKunde: (payload) => LegacyDatabaseTool.createKunde(payload),
    createObjekt: (payload) => LegacyDatabaseTool.createObjekt(payload),
    updateKundeFields: (payload) => LegacyDatabaseTool.updateKundeFields(payload),
    findObjektByName: (payload) => LegacyDatabaseTool.findObjektByName(payload),
    updateObjektFields: (payload) => LegacyDatabaseTool.updateObjektFields(payload),
    createBaurundgang: (payload) => LegacyDatabaseTool.createBaurundgang(payload),
    createQSReport: (payload) => LegacyDatabaseTool.createQSReport(payload),
    getQSReport: (payload) => LegacyDatabaseTool.getQSReport(payload),
    getQSReportByBaurundgang: (payload) => LegacyDatabaseTool.getQSReportByBaurundgang(payload),
    listKunden: () => LegacyDatabaseTool.listKunden(),
    listObjekteByKunde: (payload) => LegacyDatabaseTool.listObjekteByKunde(payload?.kundeId ?? payload),
    listBaurundgaengeByObjekt: (payload) => LegacyDatabaseTool.listBaurundgaengeByObjekt(payload?.objektId ?? payload),
    autoCreateBaurundgaengeForObjekt: (payload) =>
      LegacyDatabaseTool.autoCreateBaurundgaengeForObjekt(payload?.objektId ?? payload),
    listBauteilTemplates: () => LegacyDatabaseTool.listBauteilTemplates(),
    listKapitelTemplatesByBauteilTemplate: (payload) =>
      LegacyDatabaseTool.listKapitelTemplatesByBauteilTemplate(payload?.bauteilTemplateId ?? payload),
    listRueckmeldungstypen: () => LegacyDatabaseTool.listRueckmeldungstypen(),
    summarizeRueckmeldungen: (payload) => LegacyDatabaseTool.summarizeRueckmeldungen(payload),
    ensureBauteilForTemplate: (payload) => LegacyDatabaseTool.ensureBauteilForTemplate(payload),
    ensureKapitelForBauteil: (payload) => LegacyDatabaseTool.ensureKapitelForBauteil(payload),
    createPositionWithDefaults: (payload) => LegacyDatabaseTool.createPositionWithDefaults(payload),
    ensureQsReportForBaurundgang: (payload) => LegacyDatabaseTool.ensureQsReportForBaurundgang(payload),
    listErledigteBaurundgaenge: (payload) => LegacyDatabaseTool.listErledigteBaurundgaenge(payload),
    instantiateBauteilFromTemplate: ({ bauteilId, force = false }) =>
      instantiateBauteilFromTemplate(LegacyDatabaseTool.client, bauteilId, { force }),
    rawClient: () => LegacyDatabaseTool.client,
  },
});
