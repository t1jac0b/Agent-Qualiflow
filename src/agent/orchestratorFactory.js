import { QualiFlowAgent } from "./AgentOrchestrator.js";
import { QsRundgangAgent } from "./qsRundgang/QsRundgangAgent.js";
import { ReportAgent } from "./report/ReportAgent.js";
import { databaseTool, fileTool, mailTool, reportTool, wikiTool } from "./tools/index.js";

let qualiFlowAgentInstance = null;

function createTools() {
  return {
    database: databaseTool,
    file: fileTool,
    mail: mailTool,
    report: reportTool,
    wiki: wikiTool,
  };
}

function createQualiFlowAgent() {
  const tools = createTools();
  const agent = new QualiFlowAgent({ tools });
  const reportAgent = new ReportAgent();
  const qsRundgangAgent = new QsRundgangAgent();
  agent.registerSubAgent("report", reportAgent);
  agent.registerSubAgent("qsRundgang", qsRundgangAgent);
  return agent;
}

export function getQualiFlowAgent() {
  if (!qualiFlowAgentInstance) {
    qualiFlowAgentInstance = createQualiFlowAgent();
  }
  return qualiFlowAgentInstance;
}

export function resetQualiFlowAgent() {
  qualiFlowAgentInstance = null;
}

export function getSharedTools() {
  return createTools();
}
