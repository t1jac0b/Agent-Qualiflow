import test from "node:test";
import assert from "node:assert/strict";

import { __test__ as chatTestUtils } from "../src/agent/chat/handleChatMessage.js";

const { parseOverridesFromMessage, mergeOverrides } = chatTestUtils;

test("parseOverridesFromMessage extracts projektleiter and adressdaten", () => {
  const message = `Projektleiter: Peter Beispiel\nPLZ: 3013 Ort: Bern\nAdresse: Seeweg 10-14`;
  const overrides = parseOverridesFromMessage(message, [
    { field: "objekt.plz" },
    { field: "objekt.ort" },
    { field: "objekt.adresse" },
    { field: "projektleiter" },
  ]);

  assert.deepEqual(overrides, {
    projektleiter: "Peter Beispiel",
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
  };

  const merged = mergeOverrides(base, update);
  assert.deepEqual(merged, {
    objekt: {
      plz: "3013",
      ort: "Bern",
    },
    projektleiter: "Jasmin Hirt",
  });

  // Base object must remain unchanged
  assert.deepEqual(base, {
    objekt: { plz: "3013" },
  });
});
