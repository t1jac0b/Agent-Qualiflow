import { getQualiFlowAgent, getSharedTools, resetQualiFlowAgent } from "./orchestratorFactory.js";
import { LLMOrchestrator } from "./llm/LLMOrchestrator.js";
import { MockChatOrchestrator } from "./llm/mockChatOrchestrator.js";

let chatOrchestratorInstance = null; // LLM chat orchestrator

export function getAgentOrchestrator() {
  return getQualiFlowAgent();
}

function createChatOrchestrator() {
  if (process.env.MOCK_CHAT === "true") {
    return new MockChatOrchestrator();
  }
  const tools = getSharedTools();
  return new LLMOrchestrator({ tools });
}

export function getChatOrchestrator() {
  if (!chatOrchestratorInstance) {
    chatOrchestratorInstance = createChatOrchestrator();
  }
  return chatOrchestratorInstance;
}

export function beginQualiFlowConversation(chatId) {
  return getChatOrchestrator().beginConversation(chatId);
}

export function handleQualiFlowMessage({ chatId, message, attachmentId, uploadedBy }) {
  return getChatOrchestrator().handleMessage({ chatId, message, attachmentId, uploadedBy });
}

export function resetAgentOrchestrator() {
  chatOrchestratorInstance = null;
  resetQualiFlowAgent();
}
