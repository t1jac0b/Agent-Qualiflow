// In: index.js
import 'dotenv/config';
import fs from 'node:fs/promises';
import { runAgentCore } from './src/core/AgentCore.js';
import { renderMarkdown } from './src/render/ReportRenderer.js';
import { renderHtml } from './src/render/ReportHtmlRenderer.js';
import { DatabaseTool } from './src/tools/DatabaseTool.js';
import { makeOpenAIClient, generateExecutiveSummary } from './src/llm/OpenAIClient.js';

console.log("--- PROZESS START ---");

// Simple arg parsing: --report <id> --note "text"
const argv = process.argv.slice(2);
const getArg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const hasFlag = (name) => argv.includes(`--${name}`);

const reportArg = getArg('report');
const noteArg = getArg('note');
const formatArg = getArg('format')?.toLowerCase();
const outArg = getArg('out');
const useLlm = hasFlag('llm');
const llmModel = getArg('llm-model') || process.env.OPENAI_MODEL || 'gpt-4o';
const qsReportId = reportArg ? Number(reportArg) : undefined;

(async () => {
  if (formatArg === 'md') {
    const reportObj = await loadReport(qsReportId);
    if (!reportObj) return;
    if (useLlm) {
      await enrichWithLlmSummary(reportObj, { llmModel });
    }
    const md = renderMarkdown(reportObj);
    console.log("--- PROZESS ENDE ---");
    console.log("\n--- Markdown Report ---\n");
    console.log(md);
  } else if (formatArg === 'html') {
    const reportObj = await loadReport(qsReportId);
    if (!reportObj) return;
    if (useLlm) {
      await enrichWithLlmSummary(reportObj, { llmModel });
    }
    const html = renderHtml(reportObj);
    console.log("--- PROZESS ENDE ---");
    if (outArg) {
      await fs.writeFile(outArg, html, 'utf8');
      console.log(`HTML Report gespeichert unter: ${outArg}`);
    } else {
      console.log("\n--- HTML Report ---\n");
      console.log(html);
    }
  } else if (formatArg === 'pdf') {
    const reportObj = await loadReport(qsReportId);
    if (!reportObj) return;
    if (!outArg) {
      console.error('Bitte mit --out <pfad.pdf> den Zielpfad für das PDF angeben.');
      return;
    }
    if (useLlm) {
      await enrichWithLlmSummary(reportObj, { llmModel });
    }
    const html = renderHtml(reportObj);
    console.log("[PDF Export] Starte Playwright...");
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.pdf({
        path: outArg,
        format: 'A4',
        margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '16mm' },
        printBackground: true,
      });
      console.log("--- PROZESS ENDE ---");
      console.log(`PDF Report gespeichert unter: ${outArg}`);
    } finally {
      await browser.close();
    }
  } else {
    const finalReport = await runAgentCore({ qsReportId, note: noteArg });
    console.log("--- PROZESS ENDE ---");
    console.log("\n--- Output an Mensch (5) ---");
    console.log(finalReport);
  }
})();

async function loadReport(passedId) {
  let targetId = passedId;
  if (!targetId) {
    const latest = await DatabaseTool.client.qSReport.findFirst({
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    if (!latest) {
      console.log('Kein QSReport gefunden. Bitte Seed ausführen oder Daten anlegen.');
      return null;
    }
    targetId = latest.id;
  }
  const reportObj = await DatabaseTool.getQSReport(targetId);
  if (!reportObj) {
    console.log(`QSReport mit ID ${targetId} nicht gefunden.`);
    return null;
  }
  return reportObj;
}

async function enrichWithLlmSummary(reportObj, { llmModel }) {
  try {
    const client = makeOpenAIClient({});
    const summary = await generateExecutiveSummary({ client, model: llmModel, report: reportObj });
    if (summary) {
      reportObj.zusammenfassung = summary;
    }
  } catch (err) {
    console.error('[LLM] Zusammenfassung fehlgeschlagen:', err.message || err);
  }
}