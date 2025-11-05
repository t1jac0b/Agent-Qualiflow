// In: index.js
import { runAgentCore } from './src/core/AgentCore.js';
import { renderMarkdown } from './src/render/ReportRenderer.js';
import { DatabaseTool } from './src/tools/DatabaseTool.js';

console.log("--- PROZESS START ---");

// Simple arg parsing: --report <id> --note "text"
const argv = process.argv.slice(2);
const getArg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const reportArg = getArg('report');
const noteArg = getArg('note');
const formatArg = getArg('format');
const qsReportId = reportArg ? Number(reportArg) : undefined;

(async () => {
  if (formatArg === 'md') {
    // Render Markdown direkt aus dem DB-Objekt
    let targetId = qsReportId;
    if (!targetId) {
      const latest = await DatabaseTool.client.qSReport.findFirst({
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      if (!latest) {
        console.log('Kein QSReport gefunden. Bitte Seed ausführen oder Daten anlegen.');
        return;
      }
      targetId = latest.id;
    }
    const reportObj = await DatabaseTool.getQSReport(targetId);
    const md = renderMarkdown(reportObj);
    console.log("--- PROZESS ENDE ---");
    console.log("\n--- Markdown Report ---\n");
    console.log(md);
  } else {
    const finalReport = await runAgentCore({ qsReportId, note: noteArg });
    console.log("--- PROZESS ENDE ---");
    console.log("\n--- Output an Mensch (5) ---");
    console.log(finalReport);
  }
})();