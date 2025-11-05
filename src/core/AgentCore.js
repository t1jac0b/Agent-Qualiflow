// In: src/core/AgentCore.js
import { DatabaseTool } from "../tools/DatabaseTool.js";

/**
 * Erzeugt einen einfachen Text-Report basierend auf einem QSReport-Datensatz.
 * Wenn keine qsReportId übergeben wird, wird der zuletzt erstellte Report geladen.
 */
export async function runAgentCore({ qsReportId, note } = {}) {
  console.log("[Agent Core]: Starte mit echter DB-Anbindung...");

  // 1) Report-ID bestimmen (fallback: neuester Report)
  let targetId = qsReportId;
  if (!targetId) {
    const latest = await DatabaseTool.client.qSReport.findFirst({
      orderBy: { id: "desc" },
      select: { id: true },
    });
    if (!latest) {
      return "Kein QSReport gefunden. Bitte Seed ausführen oder Daten anlegen.";
    }
    targetId = latest.id;
  }

  // 2) Report + Relationen laden
  const report = await DatabaseTool.getQSReport(targetId);
  if (!report) {
    return `QSReport mit ID ${targetId} nicht gefunden.`;
  }

  // 3) Sehr einfacher, lesbarer Entwurf
  const lines = [];
  lines.push(`QS-Report #${report.id}`);
  lines.push(`Objekt: ${report.objekt?.bezeichnung ?? "-"}`);
  lines.push(`Kunde:  ${report.kunde?.name ?? "-"}`);
  lines.push(`Typ:    ${report.objekttyp?.bezeichnung ?? "-"}`);
  if (report.zusammenfassung) lines.push("");
  if (report.zusammenfassung) lines.push(`Zusammenfassung: ${report.zusammenfassung}`);
  lines.push("");
  lines.push("Positionen:");
  for (const p of report.positionen ?? []) {
    const fotos = (p.fotos ?? []).length;
    lines.push(
      `  #${p.positionsnummer ?? "-"} ${p.bereichstitel ?? p.bereich?.name ?? "-"} | ` +
        `${p.bemerkung ?? ""} | Fotos: ${fotos}`
    );
  }
  if (note) {
    lines.push("");
    lines.push(`Notiz: ${note}`);
  }

  return lines.join("\n");
}