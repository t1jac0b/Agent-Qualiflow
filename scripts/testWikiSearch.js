import { WikiTool } from "../src/tools/WikiTool.js";

async function main() {
  const query = process.argv.slice(2).join(" ") || "Fenster";

  console.log("[WikiTest] Root:", WikiTool.root);
  const docs = await WikiTool.listDocuments();
  console.log(`[WikiTest] Gefundene Dokumente: ${docs.length}`);

  if (!docs.length) {
    console.log("[WikiTest] Hinweis: Lege einige Wiki-Dokumente unter 'storage/wiki' an (z.B. .pdf, .md, .txt).");
    return;
  }

  console.log(`[WikiTest] Suche nach: "${query}"`);
  const results = await WikiTool.search({ query, limit: 5 });

  if (!results.length) {
    console.log("[WikiTest] Keine Treffer fr diese Suche.");
    return;
  }

  for (const hit of results) {
    console.log("\n--- Treffer ---");
    console.log("Datei:", hit.relativePath);
    console.log("Score:", hit.score);
    console.log("Snippet:");
    console.log(hit.snippet);
  }

  console.log("\n[WikiTest] Fertig.");
}

main().catch((error) => {
  console.error("[WikiTest] FAILED:", error?.message ?? error);
  process.exit(1);
});
