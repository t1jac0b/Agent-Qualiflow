import test from "node:test";
import assert from "node:assert/strict";

import { __test__ as qsAgentTestUtils } from "../src/agent/qsRundgang/QsRundgangAgent.js";

const { classifyNotes } = qsAgentTestUtils;

test("classifyNotes matches configured keywords", () => {
  const result = classifyNotes("Mangel: XPS Dämmung fehlt an der Attika");
  assert.equal(result.bauteilName, "Rohbau");
  assert.equal(result.label, "XPS Dämmung");
});

test("classifyNotes defaults to Rohbau when no keyword found", () => {
  const result = classifyNotes("Unklarer Mangel ohne Schlüsselworte");
  assert.equal(result.bauteilName, "Rohbau");
  assert.equal(result.label, null);
});
