import { defineTool } from "./toolTypes.js";
import { generateBauBeschriebReport } from "../bauBeschrieb/renderBauBeschriebReport.js";

export const reportTool = defineTool({
  name: "report",
  description: "Generates HTML/PDF artefacts for QS workflows.",
  metadata: { kind: "report" },
  actions: {
    generateBauBeschriebReport,
  },
});
