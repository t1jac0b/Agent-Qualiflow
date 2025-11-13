import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { LLMOrchestrator } from "../src/agent/llm/LLMOrchestrator.js";

describe("LLMOrchestrator – attachment handling", () => {
  const chatId = "chat-attachments";

  test("registerAttachment tracks metadata and pending count", () => {
    const orchestrator = new LLMOrchestrator({ tools: {} });
    const attachment = orchestrator.registerAttachment(chatId, {
      id: "storage/chat-uploads/chat-attachments/file.pdf",
      name: "file.pdf",
      mimeType: "application/pdf",
      size: 1_024,
    });

    assert.equal(attachment.id, "storage/chat-uploads/chat-attachments/file.pdf");

    const state = orchestrator.getState(chatId);
    assert.equal(state.pendingAttachmentIds.size, 1);
    assert.equal(state.attachments.size, 1);
    assert.equal(state.context.pendingAttachments, 1);
    assert.equal(state.context.lastAttachment.name, "file.pdf");
    assert.equal(state.context.lastAttachment.mimeType, "application/pdf");
  });

  test("process_baubeschrieb_attachment updates context and stores result", async () => {
    let capturedArgs = null;
    const orchestrator = new LLMOrchestrator({
      tools: {},
      bauBeschriebHandlers: {
        process: async (args) => {
          capturedArgs = args;
          return {
            status: "needs_input",
            ingestion: { id: "ing-1" },
            extracted: { kunde: { name: "Demo AG" } },
            pendingFields: [{ field: "projektleiter" }],
            missingMandatory: ["projektleiter"],
          };
        },
        finalize: async () => {
          throw new Error("unexpected finalize call");
        },
      },
    });

    const stored = orchestrator.registerAttachment(chatId, {
      id: "storage/chat-uploads/chat-attachments/ingestion.pdf",
      storedPath: "storage/chat-uploads/chat-attachments/ingestion.pdf",
      originalFilename: "ingestion.pdf",
      mimeType: "application/pdf",
      size: 2048,
    });

    const executors = orchestrator.getExecutors(chatId);
    const result = await executors.process_baubeschrieb_attachment({ attachmentId: stored.id });

    assert.equal(result.status, "needs_input");
    assert.deepEqual(capturedArgs, {
      filePath: stored.storedPath,
      originalFilename: stored.originalFilename,
      uploadedBy: "chat",
    });
    const state = orchestrator.getState(chatId);

    assert.equal(state.pendingAttachmentIds.size, 0, "attachment should no longer be pending after processing");
    assert.ok(state.bauBeschriebResults.has(stored.id), "processed result should be cached");
    assert.deepEqual(state.context.pendingRequirements.missingMandatory, ["projektleiter"]);
    assert.equal(state.context.kunde.name, "Demo AG");
  });

  test("finalize_baubeschrieb_attachment clears attachment and context when completed", async () => {
    let finalizeArgs = null;
    const orchestrator = new LLMOrchestrator({
      tools: {},
      bauBeschriebHandlers: {
        process: async () => {
          throw new Error("unexpected process call");
        },
        finalize: async (args) => {
          finalizeArgs = args;
          return {
            status: "created",
            ingestion: { id: "ing-2" },
            extracted: { kunde: { name: "Demo AG" } },
            kunde: { id: 1, name: "Demo AG" },
            objekt: { id: 11, bezeichnung: "Haus A", kundeId: 1 },
            projektleiter: { id: 9, name: "Max Beispiel", email: "max@example.com" },
          };
        },
      },
    });

    const stored = orchestrator.registerAttachment(chatId, {
      id: "storage/chat-uploads/chat-attachments/final.pdf",
      storedPath: "storage/chat-uploads/chat-attachments/final.pdf",
      originalFilename: "final.pdf",
    });

    const state = orchestrator.getState(chatId);
    state.bauBeschriebResults.set(stored.id, {
      ingestion: { id: "ing-2" },
      extracted: { kunde: { name: "Demo AG" } },
    });

    const executors = orchestrator.getExecutors(chatId);
    const reply = await executors.finalize_baubeschrieb_attachment({
      attachmentId: stored.id,
      overrides: { projektleiter: "Max Beispiel" },
    });

    assert.equal(reply.status, "created");
    assert.deepEqual(finalizeArgs, {
      ingestion: { id: "ing-2" },
      extracted: { kunde: { name: "Demo AG" } },
      overrides: { projektleiter: "Max Beispiel" },
    });

    const finalState = orchestrator.getState(chatId);
    assert.equal(finalState.attachments.has(stored.id), false, "attachment map should no longer contain finalized upload");
    assert.equal(finalState.bauBeschriebResults.has(stored.id), false, "result cache should be cleared after success");
    assert.equal(finalState.context.pendingRequirements, null, "pending requirements should be cleared");
    assert.equal(finalState.context.kunde.name, "Demo AG");
    assert.equal(finalState.context.objekt.bezeichnung, "Haus A");
    assert.equal(finalState.context.projektleiter.name, "Max Beispiel");
    assert.equal(finalState.context.projektleiter.email, "max@example.com");
  });
});
