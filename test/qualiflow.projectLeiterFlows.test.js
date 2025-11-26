import test from "node:test";
import assert from "node:assert/strict";

import { QualiFlowAgent } from "../src/agent/AgentOrchestrator.js";

function createPruefpunkteAgent({ datasets } = {}) {
  const checkpoints = Array.isArray(datasets) && datasets.length ? datasets : [
    [
      { id: 101, bezeichnung: "Fluchtweg beschildert", erledigt: false, notiz: "Beschilderung prüfen" },
      { id: 102, bezeichnung: "Geländer", erledigt: true, notiz: null },
    ],
    [
      { id: 101, bezeichnung: "Fluchtweg beschildert", erledigt: true, notiz: "Beschilderung prüfen" },
      { id: 102, bezeichnung: "Geländer", erledigt: true, notiz: null },
    ],
  ];

  let index = 0;
  const calls = {
    listPruefpunkteByBaurundgang: [],
    setPruefpunktErledigt: [],
  };

  const actions = {
    async listPruefpunkteByBaurundgang(baurundgangId) {
      calls.listPruefpunkteByBaurundgang.push({ baurundgangId });
      const current = checkpoints[Math.min(index, checkpoints.length - 1)];
      index += 1;
      return JSON.parse(JSON.stringify(current));
    },
    async setPruefpunktErledigt({ id, erledigt }) {
      calls.setPruefpunktErledigt.push({ id, erledigt });
      return { id, erledigt };
    },
  };

  const agent = new QualiFlowAgent({ tools: { database: { actions } } });
  return { agent, calls };
}

test("Projektleiter: Prüfpunkte anzeigen liefert Liste und Optionen", async () => {
  const { agent, calls } = createPruefpunkteAgent();
  const chatId = "chat-pruefpunkte";

  agent.setConversation(chatId, {
    phase: "completed",
    path: {
      kunde: { id: 1, name: "Demo AG" },
      objekt: { id: 11, bezeichnung: "Haus A" },
      baurundgang: { id: 21, typ: { name: "Rohbau" } },
    },
    options: null,
  });

  const result = await agent.handleQueryIntent({
    chatId,
    message: "Prüfpunkte anzeigen",
    session: agent.getConversation(chatId),
    database: agent.tools.database,
    skipEnsure: true,
  });

  assert.equal(result.status, "pruefpunkte_list");
  assert.match(result.message, /#101 Fluchtweg/);
  assert.ok(Array.isArray(result.context.options));
  assert.equal(result.context.options.length, 3);
  assert.equal(result.context.options[0].inputValue, "pp:refresh");

  const sessionAfter = agent.getConversation(chatId);
  assert.equal(sessionAfter.phase, "pruefpunkte:list");
  assert.equal(sessionAfter.options.length, 3);
  assert.equal(calls.listPruefpunkteByBaurundgang.length, 1);
});

test("Projektleiter: Prüfpunkte toggeln ruft Datenbank auf und listet erneut", async () => {
  const { agent, calls } = createPruefpunkteAgent();
  const chatId = "chat-pruefpunkte-toggle";

  agent.setConversation(chatId, {
    phase: "completed",
    path: {
      kunde: { id: 1, name: "Demo AG" },
      objekt: { id: 11, bezeichnung: "Haus A" },
      baurundgang: { id: 21, typ: { name: "Rohbau" } },
    },
    options: null,
  });

  await agent.handleQueryIntent({
    chatId,
    message: "Prüfpunkte anzeigen",
    session: agent.getConversation(chatId),
    database: agent.tools.database,
    skipEnsure: true,
  });

  const sessionList = agent.getConversation(chatId);
  const toggleResult = await agent.continuePruefpunkteFlow({
    chatId,
    session: sessionList,
    message: "pp:toggle:101:true",
  });

  assert.equal(toggleResult.status, "pruefpunkte_list");
  assert.match(toggleResult.message, /#101 Fluchtweg/);
  assert.equal(calls.setPruefpunktErledigt.length, 1);
  assert.deepEqual(calls.setPruefpunktErledigt[0], { id: 101, erledigt: true });
  assert.equal(calls.listPruefpunkteByBaurundgang.length, 2, "liste sollte erneut geladen werden");
});

test("Projektleiter: Delete-Guardrail verhindert automatisches Löschen", async () => {
  const agent = new QualiFlowAgent();
  const chatId = "chat-delete-guardrail";

  agent.setConversation(chatId, {
    phase: "completed",
    path: {
      kunde: { id: 7, name: "Alpha Bau" },
    },
  });

  const deleteInit = await agent.handleDeleteIntent({
    chatId,
    message: "Kunde löschen",
    session: agent.getConversation(chatId),
  });

  assert.equal(deleteInit.status, "delete_confirm");
  const sessionConfirm = agent.getConversation(chatId);
  assert.equal(sessionConfirm.phase, "delete:confirm");

  const guardrail = await agent.continueDeleteFlow({
    chatId,
    session: sessionConfirm,
    message: "ja",
  });

  assert.equal(guardrail.status, "delete_guardrail");
  assert.match(guardrail.message, /nicht automatisch gelöscht/i);
  const finalSession = agent.getConversation(chatId);
  assert.equal(finalSession.phase, "completed");
  assert.equal(finalSession.delete, null);
});
