import { QualiFlowAgent } from "./AgentOrchestrator.js";
import { QsRundgangAgent } from "./qsRundgang/QsRundgangAgent.js";
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

export function resetAgentOrchestrator() {
  orchestratorInstance = null;
}
