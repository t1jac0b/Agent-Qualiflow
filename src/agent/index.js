import { AgentOrchestrator } from "./AgentOrchestrator.js";
import { ReportAgent } from "./report/ReportAgent.js";
import { databaseTool, fileTool, mailTool, reportTool } from "./tools/index.js";

let orchestratorInstance = null;

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
  const orchestrator = new AgentOrchestrator({ tools });
  const reportAgent = new ReportAgent();
  orchestrator.registerSubAgent("report", reportAgent);
  return orchestrator;
}

export function getAgentOrchestrator() {
  if (!orchestratorInstance) {
    orchestratorInstance = createOrchestrator();
  }
  return orchestratorInstance;
}

export function resetAgentOrchestrator() {
  orchestratorInstance = null;
}
