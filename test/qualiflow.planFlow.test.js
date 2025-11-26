import test from "node:test";
import assert from "node:assert/strict";

import { QualiFlowAgent } from "../src/agent/AgentOrchestrator.js";

function createFakeDatabase() {
  const calls = {
    listBaurundgaengeByObjekt: [],
    autoCreateBaurundgaengeForObjekt: [],
    updateBaurundgang: [],
  };

  const actions = {
    async listBaurundgaengeByObjekt(objektId) {
      calls.listBaurundgaengeByObjekt.push({ objektId });
      return [
        {
          id: 10,
          status: "geplant",
          datumGeplant: null,
          datumDurchgefuehrt: null,
          typ: { nummer: 1, name: "Rohbauarbeiten, Wand- und Deckenlager" },
        },
        {
          id: 11,
          status: "offen",
          datumGeplant: new Date("2025-01-10T00:00:00Z"),
          datumDurchgefuehrt: null,
          typ: { nummer: 2, name: "Innenausbau" },
        },
      ];
    },

    async autoCreateBaurundgaengeForObjekt(objektId) {
      calls.autoCreateBaurundgaengeForObjekt.push({ objektId });
      return { created: 0 };
    },

    async updateBaurundgang({ id, status, datumGeplant }) {
      calls.updateBaurundgaenge = calls.updateBaurundgaenge || [];
      calls.updateBaurundgaenge.push({ id, status, datumGeplant });
      return { id, status, datumGeplant };
    },
  };

  return { actions, calls };
}

test("PLAN-Flow: listet Baurundgaenge und plant Datum", async () => {
  const { actions, calls } = createFakeDatabase();

  const agent = new QualiFlowAgent({ tools: { database: { actions } } });
  const chatId = "chat-plan-flow";

  // Setup: Kunde & Objekt bereits gewählt
  agent.setConversation(chatId, {
    phase: "completed",
    path: {
      kunde: { id: 1, name: "Demo AG" },
      objekt: { id: 11, bezeichnung: "Haus A" },
    },
    options: null,
  });

  const sessionBefore = agent.getConversation(chatId);
  assert.equal(sessionBefore.path.objekt.id, 11);

  // 1) PLAN-Intent ausführen
  const planResult = await agent.handlePlanIntent({
    chatId,
    message: "AVOR",
    session: sessionBefore,
    database: { actions },
    skipEnsure: false,
  });

  assert.equal(planResult.status, "plan_select_baurundgang");
  assert.ok(Array.isArray(planResult.context.options));
  assert.equal(planResult.context.options.length, 2);

  const sessionAfterPlan = agent.getConversation(chatId);
  assert.equal(sessionAfterPlan.phase, "plan:select-baurundgang");

  // 2) Baurundgang per Nummer auswählen
  const selectResult = await agent.continuePlanFlow({
    chatId,
    session: sessionAfterPlan,
    message: "1",
    database: { actions },
  });

  assert.equal(selectResult.status, "plan_await_date");
  assert.match(selectResult.message, /kein Datum geplant/);

  const sessionAwaitDate = agent.getConversation(chatId);
  assert.equal(sessionAwaitDate.phase, "plan:await-date");

  // 3) Datum setzen
  const planDateResult = await agent.continuePlanFlow({
    chatId,
    session: sessionAwaitDate,
    message: "2025-12-31",
    database: { actions },
  });

  assert.equal(planDateResult.status, "plan_success");
  assert.match(planDateResult.message, /2025-12-31/);

  const finalSession = agent.getConversation(chatId);
  assert.equal(finalSession.phase, "completed");

  // Datenbank-Calls überprüfen
  assert.equal(calls.listBaurundgaengeByObjekt.length, 1);
  assert.equal(calls.autoCreateBaurundgaengeForObjekt.length, 0);
  assert.ok(Array.isArray(calls.updateBaurundgaenge));
  assert.equal(calls.updateBaurundgaenge.length, 1);
  assert.equal(calls.updateBaurundgaenge[0].id, 10);
  assert.equal(calls.updateBaurundgaenge[0].status, "geplant");
  assert.ok(calls.updateBaurundgaenge[0].datumGeplant instanceof Date);
});

test("PLAN-Flow: Abbruch mit 'abbrechen' setzt Phase auf completed", async () => {
  const { actions } = createFakeDatabase();

  const agent = new QualiFlowAgent({ tools: { database: { actions } } });
  const chatId = "chat-plan-abort";

  // Setup: Kunde & Objekt bereits gewählt
  agent.setConversation(chatId, {
    phase: "completed",
    path: {
      kunde: { id: 1, name: "Demo AG" },
      objekt: { id: 11, bezeichnung: "Haus A" },
    },
    options: null,
  });

  // 1) PLAN-Intent starten
  const planResult = await agent.handlePlanIntent({
    chatId,
    message: "Planung",
    session: agent.getConversation(chatId),
    database: { actions },
    skipEnsure: false,
  });

  assert.equal(planResult.status, "plan_select_baurundgang");
  const sessionAfterPlan = agent.getConversation(chatId);
  assert.equal(sessionAfterPlan.phase, "plan:select-baurundgang");

  // 2) User bricht ab mit "abbrechen"
  const abortResult = await agent.continuePlanFlow({
    chatId,
    session: sessionAfterPlan,
    message: "abbrechen",
    database: { actions },
  });

  assert.equal(abortResult.status, "plan_cancelled");
  assert.match(abortResult.message, /abgebrochen/i);

  const finalSession = agent.getConversation(chatId);
  assert.equal(finalSession.phase, "completed");
  assert.equal(finalSession.plan, null);
});
