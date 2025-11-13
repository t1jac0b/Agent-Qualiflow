import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { LLMOrchestrator } from "../src/agent/llm/LLMOrchestrator.js";

let completionsQueue = [];
let recordedRequests = [];

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
  
  beforeEach(() => {
    completionsQueue = [];
    recordedRequests = [];

    orchestrator = new LLMOrchestrator({
      tools: {
        database: { actions: {} },
      },
      openAIProvider: createOpenAIProvider(),
    });

    orchestrator.setContext(chatId, initialContext);
  });

  afterEach(() => {
    completionsQueue = [];
    recordedRequests = [];
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
  });
});
