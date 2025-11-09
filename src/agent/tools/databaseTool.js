import { DatabaseTool as LegacyDatabaseTool } from "../../tools/DatabaseTool.js";
import { instantiateBauteilFromTemplate } from "../bauteil/instantiateFromTemplate.js";
import { defineTool } from "./toolTypes.js";

export const databaseTool = defineTool({
  name: "database",
  description: "Provides persistence helpers backed by Prisma/PostgreSQL.",
  metadata: { kind: "database" },
  actions: {
    ensureKunde: (payload) => LegacyDatabaseTool.ensureKunde(payload),
    ensureObjekttyp: (payload) => LegacyDatabaseTool.ensureObjekttyp(payload),
    createObjektForKunde: (payload) => LegacyDatabaseTool.createObjektForKunde(payload),
    createKunde: (payload) => LegacyDatabaseTool.createKunde(payload),
    createObjekt: (payload) => LegacyDatabaseTool.createObjekt(payload),
    createBaurundgang: (payload) => LegacyDatabaseTool.createBaurundgang(payload),
    createQSReport: (payload) => LegacyDatabaseTool.createQSReport(payload),
    getQSReport: (payload) => LegacyDatabaseTool.getQSReport(payload),
    instantiateBauteilFromTemplate: ({ bauteilId, force = false }) =>
      instantiateBauteilFromTemplate(LegacyDatabaseTool.client, bauteilId, { force }),
    rawClient: () => LegacyDatabaseTool.client,
  },
});
