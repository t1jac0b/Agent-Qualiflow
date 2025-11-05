// In: index.js
import { runAgentCore } from './src/core/AgentCore.js';

console.log("--- PROZESS START ---");

// Simple arg parsing: --report <id> --note "text"
const argv = process.argv.slice(2);
const getArg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const reportArg = getArg('report');
const noteArg = getArg('note');
const qsReportId = reportArg ? Number(reportArg) : undefined;

(async () => {
  const finalReport = await runAgentCore({ qsReportId, note: noteArg });
  console.log("--- PROZESS ENDE ---");
  console.log("\n--- Output an Mensch (5) ---");
  console.log(finalReport);
})();