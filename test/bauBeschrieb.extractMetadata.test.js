import test from "node:test";
import assert from "node:assert/strict";

import { __test__ } from "../src/agent/bauBeschrieb/processBauBeschrieb.js";

const { extractMetadata } = __test__;

test("extractMetadata parses PLZ/Ort labels and cleans address", () => {
  const text = [
    "Baubeschrieb",
    "Neubau Wohn- und Geschäftshaus \"Zum",
    "Lindenhof\"",
    "Adresse: Seeweg 10-14 PLZ: 3013",
    "Ort: Bern",
    "",
    "Baubeschrieb zum KV vom 20.10.2025",
    "",
    "Kunde: ImmoVision AG, Postgasse 3, 3011 Bern",
    "Objekttyp: Mehrfamilienhaus Einfach",
    "Anzahl Wohneinheiten: 24",
    "Anzahl Gewerberäume: 0",
  ].join("\n");

  const extracted = extractMetadata(text);

  assert.equal(extracted.kunde.name, "ImmoVision AG, Postgasse 3, 3011 Bern");
  assert.equal(extracted.objekttyp, "Mehrfamilienhaus Einfach");
  assert.equal(extracted.objekt.adresse, "Seeweg 10-14");
  assert.equal(extracted.objekt.plz, "3013");
  assert.equal(extracted.objekt.ort, "Bern");
  assert.equal(extracted.objekt.notiz, "Wohneinheiten: 24\nGewerberäume: 0");

  const missingFields = new Set(extracted.pendingFields.map((item) => item.field));
  assert.ok(!missingFields.has("objekt.plz"), "PLZ should be resolved");
  assert.ok(!missingFields.has("objekt.ort"), "Ort should be resolved");
  assert.ok(missingFields.has("projektleiter"), "Projektleiter stays pending");
});
