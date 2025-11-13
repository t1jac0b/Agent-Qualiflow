import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { LLMOrchestrator } from "../src/agent/llm/LLMOrchestrator.js";

let completionsQueue = [];
let recordedRequests = [];
let ensureKundeCalls = [];

function createOpenAIProvider() {
  return {
    getClient: () => ({
      chat: {
        completions: {
          create: async (request) => {
            recordedRequests.push(request);
            const next = completionsQueue.shift();
            if (!next) {
              throw new Error("No completion stub available");
            }
            return next;
          },
        },
      },
    }),
    getModel: () => "gpt-test",
  };
}

function makeToolCall(id, name, args = {}) {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function makeToolCompletion(...toolCalls) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: toolCalls,
        },
      },
    ],
  };
}

describe("LLMOrchestrator – neuer Kunde Flow", () => {
  const chatId = "chat-test";
  const initialContext = {
    kunde: { id: 42, name: "Bestandskunde AG" },
    objekt: { id: 99, bezeichnung: "Projekt Nord" },
    baurundgang: { id: 7, typ: { name: "Rohbau" } },
  };

  let orchestrator;
  let openAIProvider;

  beforeEach(() => {
    completionsQueue = [];
    recordedRequests = [];
    ensureKundeCalls = [];
    openAIProvider = createOpenAIProvider();

    orchestrator = new LLMOrchestrator({
      tools: {
        database: {
          actions: {
            ensureKunde: async (payload) => {
              ensureKundeCalls.push(payload);
              return {
                id: 501,
                ...payload,
              };
            },
          },
        },
      },
      openAIProvider,
    });

    orchestrator.setContext(chatId, initialContext);
  });

  afterEach(() => {
    completionsQueue = [];
    recordedRequests = [];
    ensureKundeCalls = [];
  });

  test("bricht neuen Kunden anlegen nach Nein ab und stellt Kontext wieder her", async () => {
    const originalContextSnapshot = JSON.parse(JSON.stringify(initialContext));

    completionsQueue.push(
      makeToolCompletion(makeToolCall("call_push", "push_context", { label: "kundenauswahl" })),
    );
    completionsQueue.push(
      makeToolCompletion(
        makeToolCall("call_reply_confirm", "reply", {
          status: "confirm_new_customer",
          message: "Soll ich den aktuellen Kundenkontext verlassen und einen neuen Kunden anlegen?",
          options: [
            { id: 1, label: "Ja, neuen Kunden anlegen", inputValue: "ja" },
            { id: 2, label: "Nein, zurück", inputValue: "nein" },
          ],
          context: { phase: "confirm-new-customer" },
        }),
      ),
    );

    const confirmationReply = await orchestrator.handleMessage({
      chatId,
      message: "Ich möchte einen neuen Kunden anlegen",
    });

    assert.equal(recordedRequests.length, 2, "expected two LLM calls for confirmation");
    assert.equal(completionsQueue.length, 0);
    assert.deepEqual(confirmationReply, {
      status: "confirm_new_customer",
      message: "Soll ich den aktuellen Kundenkontext verlassen und einen neuen Kunden anlegen?",
      options: [
        { id: 1, label: "Ja, neuen Kunden anlegen", inputValue: "ja" },
        { id: 2, label: "Nein, zurück", inputValue: "nein" },
      ],
      context: { phase: "confirm-new-customer" },
    });

    const stateAfterConfirm = orchestrator.getState(chatId);
    assert.equal(stateAfterConfirm.contextStack.length, 1, "context snapshot should be stacked");

    completionsQueue.push(
      makeToolCompletion(makeToolCall("call_pop", "pop_context", { restore: true })),
    );
    completionsQueue.push(
      makeToolCompletion(
        makeToolCall("call_reply_cancelled", "reply", {
          status: "new_customer_cancelled",
          message: "Alles klar, wir bleiben beim aktuellen Kunden.",
          context: { phase: "select-customer" },
        }),
      ),
    );

    const cancelReply = await orchestrator.handleMessage({ chatId, message: "nein" });

    assert.equal(recordedRequests.length, 4, "expected two additional LLM calls for cancellation");
    assert.equal(completionsQueue.length, 0);
    assert.deepEqual(cancelReply, {
      status: "new_customer_cancelled",
      message: "Alles klar, wir bleiben beim aktuellen Kunden.",
      context: { phase: "select-customer" },
    });

    const finalState = orchestrator.getState(chatId);
    assert.equal(finalState.contextStack.length, 0, "context stack should be empty after pop restore");
    assert.deepEqual(finalState.context, originalContextSnapshot, "context should be restored to original snapshot");
    assert.equal(ensureKundeCalls.length, 0, "ensureKunde should not be called on cancellation");
  });

  test("legt neuen Kunden nach Bestätigung an und aktualisiert Kontext", async () => {
    const originalContextSnapshot = JSON.parse(JSON.stringify(initialContext));

    completionsQueue.push(
      makeToolCompletion(makeToolCall("call_push", "push_context", { label: "kundenauswahl" })),
    );
    completionsQueue.push(
      makeToolCompletion(
        makeToolCall("call_reply_confirm", "reply", {
          status: "confirm_new_customer",
          message: "Soll ich den aktuellen Kundenkontext verlassen und einen neuen Kunden anlegen?",
          options: [
            { id: 1, label: "Ja, neuen Kunden anlegen", inputValue: "ja" },
            { id: 2, label: "Nein, zurück", inputValue: "nein" },
          ],
          context: { phase: "confirm-new-customer" },
        }),
      ),
    );

    const confirmationReply = await orchestrator.handleMessage({
      chatId,
      message: "Bitte neuen Kunden anlegen",
    });

    assert.equal(confirmationReply.status, "confirm_new_customer");

    completionsQueue.push(
      makeToolCompletion(
        makeToolCall("call_reset_context", "set_context", {
          kunde: null,
          objekt: null,
          baurundgang: null,
        }),
        makeToolCall("call_create_kunde", "create_kunde", {
          name: "Neukunde GmbH",
          adresse: "Musterstrasse 1",
          plz: "7000",
          ort: "Chur",
        }),
        makeToolCall("call_pop", "pop_context", { restore: false }),
        makeToolCall("call_reply_done", "reply", {
          status: "new_customer_created",
          message: "Neuer Kunde 'Neukunde GmbH' wurde angelegt. Wähle das zugehörige Objekt.",
          options: [
            { id: 10, label: "Objekt erfassen", inputValue: "objekt anlegen" },
          ],
          context: { phase: "select-object" },
        }),
      ),
    );

    const finalReply = await orchestrator.handleMessage({ chatId, message: "ja" });

    assert.equal(finalReply.status, "new_customer_created");
    assert.equal(ensureKundeCalls.length, 1, "ensureKunde should be invoked once");
    assert.deepEqual(ensureKundeCalls[0], {
      name: "Neukunde GmbH",
      adresse: "Musterstrasse 1",
      plz: "7000",
      ort: "Chur",
    });

    const state = orchestrator.getState(chatId);
    assert.equal(state.contextStack.length, 0, "context stack should be empty after pop without restore");
    assert.deepEqual(state.context.kunde, {
      id: 501,
      name: "Neukunde GmbH",
      adresse: "Musterstrasse 1",
      plz: "7000",
      ort: "Chur",
    });
    assert.equal(state.context.objekt, null);
    assert.equal(state.context.baurundgang, null);

    assert.deepEqual(originalContextSnapshot, initialContext, "Original snapshot remains unchanged for reference");
  });
});
