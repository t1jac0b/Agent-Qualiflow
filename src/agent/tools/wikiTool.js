import { WikiTool as LegacyWikiTool } from "../../tools/WikiTool.js";
import { defineTool } from "./toolTypes.js";

export const wikiTool = defineTool({
  name: "wiki",
  description: "Durchsucht interne Wiki-Dokumente (PDF/Markdown/TXT) unter storage/wiki.",
  metadata: { kind: "wiki" },
  actions: {
    listDocuments: () => LegacyWikiTool.listDocuments(),
    search: (payload) => LegacyWikiTool.search(payload ?? {}),
    readDocument: (payload) => LegacyWikiTool.readDocument(payload ?? {}),
  },
});
