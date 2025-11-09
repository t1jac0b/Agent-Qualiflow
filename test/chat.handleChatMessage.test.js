import test from "node:test";
import assert from "node:assert/strict";

import { __test__ as chatTestUtils } from "../src/agent/chat/handleChatMessage.js";

const { parseOverridesFromMessage, mergeOverrides } = chatTestUtils;

test("parseOverridesFromMessage extracts projektleiter and contact data", () => {
  const message = [
    "Projektleiter: Peter Beispiel",
    "Projektleiter Email: peter.beispiel@example.com",
    "Projektleiter Tel: +41 31 000 00 00",
    "PLZ: 3013 Ort: Bern",
    "Adresse: Seeweg 10-14",
  ].join("\n");
  const overrides = parseOverridesFromMessage(message, [
    { field: "objekt.plz" },
    { field: "objekt.ort" },
    { field: "objekt.adresse" },
    { field: "projektleiter" },
  ]);

  assert.deepEqual(overrides, {
    projektleiter: "Peter Beispiel",
    projektleiterEmail: "peter.beispiel@example.com",
    projektleiterTelefon: "+41 31 000 00 00",
    objekt: {
      plz: "3013",
      ort: "Bern",
      adresse: "Seeweg 10-14",
    },
  });
});

test("mergeOverrides keeps existing values and extends", () => {
  const base = {
    objekt: { plz: "3013" },
  };
  const update = {
    objekt: { ort: "Bern" },
    projektleiter: "Jasmin Hirt",
    projektleiterEmail: "jasmin.hirt@example.com",
  };

  const merged = mergeOverrides(base, update);
  assert.deepEqual(merged, {
    objekt: {
      plz: "3013",
      ort: "Bern",
    },
    projektleiter: "Jasmin Hirt",
    projektleiterEmail: "jasmin.hirt@example.com",
  });

  // Base object must remain unchanged
  assert.deepEqual(base, {
    objekt: { plz: "3013" },
  });
});
