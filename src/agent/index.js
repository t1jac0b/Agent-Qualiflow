import { QualiFlowAgent } from "./AgentOrchestrator.js";
import { QsRundgangAgent } from "./qsRundgang/QsRundgangAgent.js";
import { ReportAgent } from "./report/ReportAgent.js";
import { databaseTool, fileTool, mailTool, reportTool } from "./tools/index.js";
import { LLMOrchestrator } from "./llm/LLMOrchestrator.js";

let orchestratorInstance = null; // legacy/task orchestrator
let chatOrchestratorInstance = null; // LLM chat orchestrator

function createTools() {
  return {
    database: databaseTool,
    file: fileTool,
    mail: mailTool,
    report: reportTool,
  };
}

function createOrchestrator() {
  const tools = createTools();
  const orchestrator = new QualiFlowAgent({ tools });
  const reportAgent = new ReportAgent();
  const qsRundgangAgent = new QsRundgangAgent();
  orchestrator.registerSubAgent("report", reportAgent);
  orchestrator.registerSubAgent("qsRundgang", qsRundgangAgent);
  return orchestrator;
}

export function getAgentOrchestrator() {
  if (!orchestratorInstance) {
    orchestratorInstance = createOrchestrator();
  }
  return orchestratorInstance;
}

function createChatOrchestrator() {
  const tools = createTools();
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
  orchestratorInstance = null;
  chatOrchestratorInstance = null;
}
