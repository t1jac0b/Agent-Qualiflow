import test from "node:test";
import assert from "node:assert/strict";

import { __test__ as qsAgentTestUtils } from "../src/agent/qsRundgang/QsRundgangAgent.js";

const { classifyNotes, determineMatchOutcome, formatOptionsMessage } = qsAgentTestUtils;

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

test("determineMatchOutcome returns clear outcome for unique best match", () => {
  const templates = [
    {
      id: 1,
      text: "Kratzer an der Fensterbank ausbessern",
      bauteilTemplateId: 101,
      bauteilName: "Fenster",
      bereichName: "Fensterbank",
      kapitelName: "Mängel",
    },
    {
      id: 2,
      text: "Risse in der Fassade schließen",
      bauteilTemplateId: 102,
      bauteilName: "Fassade",
    },
  ];

  const outcome = determineMatchOutcome("Kratzer Fensterbank", templates);
  assert.equal(outcome.outcome, "clear");
  assert.equal(outcome.bestMatches.length, 1);
  assert.equal(outcome.bestMatches[0].bauteilName, "Fenster");
});

test("determineMatchOutcome returns ambiguous outcome and options when multiple top matches", () => {
  const templates = [
    {
      id: 1,
      text: "Riss in der Fassade sanieren",
      bauteilTemplateId: 201,
      bauteilName: "Fassade",
    },
    {
      id: 2,
      text: "Riss in der Mauer verfüllen",
      bauteilTemplateId: 202,
      bauteilName: "Mauer",
    },
  ];

  const outcome = determineMatchOutcome("Riss in der Fassade und Mauer", templates);
  assert.equal(outcome.outcome, "ambiguous");
  assert.equal(outcome.bestMatches.length, 2);

  const options = Array.from(new Set(outcome.bestMatches.map((item) => item.bauteilName)));
  const message = formatOptionsMessage(options);
  assert.match(message, /Fassade/);
  assert.match(message, /Mauer/);
});
