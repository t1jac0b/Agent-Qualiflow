import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { processBauBeschriebUpload } from "../src/agent/bauBeschrieb/processBauBeschrieb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("Bau-Beschrieb fixture PDF can be processed without errors", async (t) => {
  const pdfPath = path.join(__dirname, "fixtures", "BauBeschriebFixture.pdf");

  let buffer;
  try {
    buffer = await fs.readFile(pdfPath);
  } catch (error) {
    t.skip(`Fixture PDF not found at ${pdfPath}`);
  }

  const result = await processBauBeschriebUpload({
    buffer,
    filePath: pdfPath,
    originalFilename: "BauBeschriebFixture.pdf",
    uploadedBy: "test",
  });

  // Debug-Ausgabe, um zu sehen, welche Kundendaten aus dem PDF extrahiert werden
  // (name, adresse, plz, ort).
  // Wird im Test-Output angezeigt, damit wir das Parsing verifizieren können.
  // eslint-disable-next-line no-console
  console.log("[BauBeschriebFixture] extracted.kunde =", result.extracted?.kunde);

  assert.ok(result);
  assert.ok(result.status === "needs_input" || result.status === "created");
  assert.ok(result.extracted);
  assert.ok(result.extracted.kunde);
  assert.ok(result.extracted.kunde.name);
});
