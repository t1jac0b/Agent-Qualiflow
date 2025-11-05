// In: src/render/ReportHtmlRenderer.js
// Minimal HTML renderer for QSReport using inline CSS (A4-friendly)

import { formatDateISO } from "./ReportRenderer.js";

export function renderHtml(report) {
  const date = report.baurundgang?.datumDurchgefuehrt ?? report.baurundgang?.datumGeplant;
  const dateStr = formatDateISO(date);
  const title = `QS-Report ${report.id}: Baurundgang vom ${dateStr}`;

  const titleImg = report.titelbildURL || report.baurundgang?.fotos?.[0]?.dateiURL;

  const rowsPositions = (report.positionen ?? []).map((p) => {
    const pos = p.positionsnummer ?? "-";
    const bauteil = p.bauteil?.template?.name || p.bauteil?.materialisierung?.name || p.bereichstitel || p.bereich?.name || "-";
    const fotos = (p.fotos ?? []).map((pf) => pf.foto?.dateiURL).filter(Boolean);
    const aktion = `${p.rueckmeldungstyp?.name ?? ""}${p.bemerkung ? (p.rueckmeldungstyp?.name ? ": " : "") + p.bemerkung : ""}` || "-";

    const fotosHtml = fotos.length
      ? `<div class="fotos">${fotos
          .map((u) => `<div class="foto"><img src="${escapeHtml(u)}" alt="foto"/></div>`)
          .join("")}</div>`
      : "-";

    return `<tr>
      <td class="pos">${pos}</td>
      <td>${escapeHtml(bauteil)}</td>
      <td>${fotosHtml}</td>
      <td>${escapeHtml(aktion)}</td>
    </tr>`;
  }).join("");

  const rowsPruef = (report.positionen ?? []).map((p) => {
    const pos = p.positionsnummer ?? "-";
    const frist = formatDateISO(p.frist);
    const erledigt = formatDateISO(p.erledigtAm);
    const bemerkung = p.rueckmeldungBemerkung || p.bemerkung || "-";
    return `<tr>
      <td class="pos">${pos}</td>
      <td>${frist}</td>
      <td>${erledigt}</td>
      <td>${escapeHtml(bemerkung)}</td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    h2 { font-size: 18px; margin: 24px 0 8px; }
    h3 { font-size: 16px; margin: 16px 0 8px; }
    .meta ul { list-style: none; padding: 0; margin: 0 0 12px; }
    .meta li { margin: 2px 0; }
    .title-img { margin: 8px 0 16px; }
    .title-img img { max-width: 100%; height: auto; border: 1px solid #ddd; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
    th { background: #f3f6fb; text-align: left; }
    td.pos, th.pos { width: 42px; text-align: right; }
    .fotos { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
    .foto img { width: 100%; height: auto; border: 1px solid #ddd; }
    .page-break { page-break-before: always; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
  </header>

  <section class="meta">
    <h2>Objekt- und Kundendaten</h2>
    <ul>
      <li><strong>Kunde:</strong> ${escapeHtml(report.kunde?.name ?? "-")}</li>
      <li><strong>Objekt:</strong> ${escapeHtml(report.objekt?.bezeichnung ?? "-")}</li>
      <li><strong>Objekttyp:</strong> ${escapeHtml(report.objekttyp?.bezeichnung ?? "-")}</li>
      <li><strong>Adresse:</strong> ${escapeHtml(report.objekt?.adresse ?? "-")}</li>
      <li><strong>PLZ/Ort:</strong> ${escapeHtml([report.objekt?.plz, report.objekt?.ort].filter(Boolean).join(" ") || "-")}</li>
      ${report.kontakt?.name ? `<li><strong>Ansprechperson:</strong> ${escapeHtml(report.kontakt.name)}</li>` : ""}
    </ul>
    ${titleImg ? `<div class="title-img"><img src="${escapeHtml(titleImg)}" alt="Titelbild"/></div>` : ""}
  </section>

  <section class="page-break">
    <h2>1. Zusammenfassung</h2>
    <p>${escapeHtml(report.zusammenfassung || "-")}</p>
  </section>

  <section>
    <h2>2. Baurundgang</h2>
    <h3>2.1 Details / Problembereiche</h3>
    <table>
      <thead>
        <tr>
          <th class="pos">Pos</th>
          <th>Bauteil/Bereich</th>
          <th>Fotos</th>
          <th>Aktion</th>
        </tr>
      </thead>
      <tbody>
        ${rowsPositions}
      </tbody>
    </table>
  </section>

  <section class="page-break">
    <h2>3. Prüfprotokoll / Unterlagen</h2>
    <table>
      <thead>
        <tr>
          <th class="pos">Pos</th>
          <th>Datum bis (Frist)</th>
          <th>Datum erledigt</th>
          <th>Bemerkung</th>
        </tr>
      </thead>
      <tbody>
        ${rowsPruef}
      </tbody>
    </table>
  </section>

  <section>
    <h2>4. Diverses</h2>
    <p>${escapeHtml(report.diverses || "-")}</p>
  </section>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
