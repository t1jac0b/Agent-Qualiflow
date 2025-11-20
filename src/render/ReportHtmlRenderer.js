// In: src/render/ReportHtmlRenderer.js
// HTML renderer for QSReport

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatDateISO } from "./ReportRenderer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, "..", "assets");

const assetCache = new Map();

function getAssetDataUri(filename) {
  if (!filename) return null;
  if (assetCache.has(filename)) return assetCache.get(filename);

  try {
    const filePath = path.join(ASSETS_DIR, filename);
    const svg = readFileSync(filePath, "utf8");
    const base64 = Buffer.from(svg, "utf8").toString("base64");
    const dataUri = `data:image/svg+xml;base64,${base64}`;
    assetCache.set(filename, dataUri);
    return dataUri;
  } catch (error) {
    console.warn(`[ReportHtmlRenderer] Asset '${filename}' konnte nicht geladen werden:`, error.message);
    assetCache.set(filename, null);
    return null;
  }

}

function normalizeImageUrl(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^data:/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;

  // If it starts with /storage/, map to local absolute path and then to file:// URL
  if (/^\/?storage\//i.test(raw)) {
    const rel = raw.replace(/^\/+/, "");
    const abs = path.join(process.cwd(), rel);
    return pathToFileURL(abs).href;
  }

  // If it contains a 'storage' segment, rebuild from that segment
  const ix = raw.toLowerCase().lastIndexOf("storage");
  if (ix >= 0) {
    const relFromStorage = raw.slice(ix).replace(/\\+/g, "/");
    const abs = path.join(process.cwd(), relFromStorage);
    return pathToFileURL(abs).href;
  }

  // Absolute filesystem path
  if (path.isAbsolute(raw)) {
    return pathToFileURL(raw).href;
  }

  // Fallback: treat as relative to cwd
  return pathToFileURL(path.join(process.cwd(), raw)).href;
}

export function renderHtml(report) {
  const reportDate = report.baurundgang?.datumDurchgefuehrt ?? report.baurundgang?.datumGeplant;
  const reportDateStr = formatDateISO(reportDate);
  const generatedAtStr = formatDateISO(report.erstelltAm ?? new Date());
  const reportId = report.id != null ? `QS-${report.id}` : "QS-Report";
  const objectName = report.objekt?.bezeichnung ?? "QS-Report";
  const subtitle = reportDateStr !== "-" ? `Baurundgang vom ${reportDateStr}` : "Baurundgang";

  const titleImg = normalizeImageUrl(report.titelbildURL || report.baurundgang?.fotos?.[0]?.dateiURL);

  const primaryLogo = getAssetDataUri("qualicasa-logo.svg");
  const whiteLogo = getAssetDataUri("qualicasa-logo-white.svg");
  const supersignLogo = getAssetDataUri("qualicasa-supersign.svg");

  const positions = [...(report.positionen ?? [])].sort((a, b) => {
    const ar = a.bauteil?.template?.reihenfolge ?? Number.MAX_SAFE_INTEGER;
    const br = b.bauteil?.template?.reihenfolge ?? Number.MAX_SAFE_INTEGER;
    if (ar !== br) return ar - br;

    const ak = a.bereichKapitel?.reihenfolge ?? null;
    const bk = b.bereichKapitel?.reihenfolge ?? null;
    if (ak != null && bk != null && ak !== bk) return ak - bk;

    const as = (a.bereichstitel ?? "").toLowerCase();
    const bs = (b.bereichstitel ?? "").toLowerCase();
    if (as && bs && as !== bs) return as < bs ? -1 : 1;

    const aPos = a.positionsnummer ?? Number.MAX_SAFE_INTEGER;
    const bPos = b.positionsnummer ?? Number.MAX_SAFE_INTEGER;
    return aPos - bPos;
  });

  // Assign sequential position numbers based on the sorted order
  const numbered = positions.map((p, idx) => ({ p, posNo: idx + 1 }));

  const positionsRows = numbered
    .map(({ p, posNo }) => {
      const pos = String(posNo);
      const bauteil =
        p.bauteil?.template?.name ||
        p.bauteil?.materialisierung?.name ||
        p.bereichstitel ||
        p.bereich?.name ||
        "-";
      const fotos = (p.fotos ?? [])
        .map((pf) => normalizeImageUrl(pf.foto?.dateiURL))
        .filter(Boolean);
      const rmNames = (p.rueckmeldungen ?? []).map((r) => r?.rueckmeldungstyp?.name).filter(Boolean);
      const rmDisplay = rmNames.length ? rmNames.join(" + ") : (p.rueckmeldungstyp?.name ?? "");
      const aktion = `${rmDisplay}${p.bemerkung ? (rmDisplay ? ": " : "") + p.bemerkung : ""}` || "-";

      const fotosHtml = fotos.length
        ? `<div class="foto-grid">${fotos
            .map(
              (url, idx) =>
                `<div class="foto-item"><img src="${escapeHtml(url)}" alt="Foto ${escapeHtml(
                  String(pos)
                )}-${idx + 1}" /></div>`
            )
            .join("")}</div>`
        : '<span class="muted">Keine Fotos</span>';

      return `<tr>
        <td class="pos">${escapeHtml(pos)}</td>
        <td>
          <div class="cell-title">${escapeHtml(bauteil)}</div>
          ${
            p.bereichstitel && !bauteil?.includes?.(p.bereichstitel)
              ? `<div class="cell-subtitle">${escapeHtml(p.bereichstitel)}</div>`
              : ""
          }
        </td>
        <td>${fotosHtml}</td>
        <td>${escapeHtml(aktion)}</td>
      </tr>`;
    })
    .join("");

  const relevantPositions = numbered.filter(({ p }) =>
    (p.rueckmeldungen?.length || p.rueckmeldungstyp?.name) || p.frist || p.erledigt === false || p.rueckmeldungBemerkung
  );

  const pruefRows = relevantPositions
    .map(({ p, posNo }) => {
      const pos = String(posNo);
      const frist = formatDateISO(p.frist);
      const erledigt = formatDateISO(p.erledigtAm);
      const bemerkung = p.rueckmeldungBemerkung || p.bemerkung || "-";
      const status = p.erledigt === false ? "Offen" : p.erledigtAm ? "Erledigt" : "In Prüfung";
      return `<tr>
        <td class="pos">${escapeHtml(pos)}</td>
        <td>${escapeHtml(status)}</td>
        <td>${frist}</td>
        <td>${erledigt}</td>
        <td>${escapeHtml(bemerkung)}</td>
      </tr>`;
    })
    .join("");

  const positionsBody =
    positionsRows || '<tr class="empty-row"><td colspan="4">Keine Positionen vorhanden.</td></tr>';
  const pruefBody =
    pruefRows || '<tr class="empty-row"><td colspan="5">Keine offenen Punkte vorhanden.</td></tr>';

  const tocStructure = [
    { number: "1", title: "Zusammenfassung", target: "section-zusammenfassung" },
    {
      number: "2",
      title: "Baurundgang",
      target: "section-baurundgang",
      children: [
        { number: "2.1", title: "Details / Problembereiche", target: "section-baurundgang-details" },
      ],
    },
    { number: "3", title: "Prüfprotokoll / Unterlagen", target: "section-pruefprotokoll" },
    { number: "4", title: "Diverses", target: "section-diverses" },
  ];

  const metaEntries = buildMetaEntries(report, reportId, reportDateStr);
  const impressumHtml = renderImpressum(report);
  const metaGridHtml = renderMetaGrid(metaEntries);
  const summaryHtml = renderParagraphs(report.zusammenfassung);
  const diversHtml = renderParagraphs(report.diverses);
  const teilnehmerNote = renderTeilnehmer(report);

  const headerHtml = renderPageHeader(primaryLogo || whiteLogo, objectName, subtitle, reportId, generatedAtStr);
  const tocHtml = renderToc(tocStructure);

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(`${objectName} · ${reportId}`)}</title>
  <style>
    :root {
      color-scheme: light;
      --brand-red: #e94e44;
      --brand-red-dark: #d64037;
      --brand-grey: #4b5563;
      --brand-grey-light: #9ca3af;
      --brand-grey-dark: #111827;
      --surface: #ffffff;
      --surface-soft: #f9fafb;
      --border: #e5e7eb;
      --text-body: #1f2933;
      --text-muted: #6b7280;
      --font-headline: "Helvetica Neue", Helvetica, Arial, sans-serif;
      --font-body: "Inter", "Roboto", "Helvetica Neue", Arial, sans-serif;
    }

    @page {
      size: A4;
      margin: 0;
    }

    body {
      margin: 0;
      padding: 0;
      font-family: var(--font-body);
      background: #f3f4f6;
      color: var(--text-body);
      counter-reset: page;
    }

    * {
      box-sizing: border-box;
    }

    a { color: inherit; text-decoration: none; }

    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: var(--surface);
      display: flex;
      flex-direction: column;
      position: relative;
      page-break-after: always;
      counter-increment: page;
    }

    .page:last-of-type {
      page-break-after: auto;
    }

    .page-inner {
      padding: 26mm 24mm 24mm;
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
    }

    .page.cover {
      color: #fff;
      background: linear-gradient(128deg, #e94e44 0%, #cc382f 58%, rgba(249, 145, 136, 0.72) 100%);
      overflow: hidden;
    }

    .page.cover .page-inner {
      padding: 36mm 34mm 30mm;
    }

    .cover-logo {
      width: 150px;
      height: auto;
    }

    .cover-supersign {
      position: absolute;
      bottom: -26mm;
      right: -40mm;
      width: 230mm;
      max-width: 90%;
      opacity: 0.18;
      pointer-events: none;
    }

    .cover-headline {
      margin-top: 22mm;
      max-width: 70%;
      position: relative;
      z-index: 1;
    }

    .cover-headline .label {
      text-transform: uppercase;
      letter-spacing: 0.24em;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 12px;
      color: rgba(255, 255, 255, 0.82);
    }

    .cover-headline h1 {
      font-family: var(--font-headline);
      font-size: 44px;
      margin: 0;
      line-height: 1.04;
      letter-spacing: 0.01em;
    }

    .cover-subtitle {
      margin-top: 10px;
      font-size: 18px;
      color: rgba(255, 255, 255, 0.85);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .cover-meta {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12mm;
      margin-top: 24mm;
      font-size: 14px;
    }

    .cover-meta-label {
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.12em;
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 6px;
      font-size: 12px;
    }

    .cover-meta-value {
      font-size: 18px;
      font-weight: 500;
    }

    .cover-image {
      position: relative;
      z-index: 1;
      margin-top: 26mm;
      border-radius: 18px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.28);
      box-shadow: 0 18px 32px rgba(0, 0, 0, 0.25);
      max-width: 165mm;
    }

    .cover-image img {
      width: 100%;
      height: auto;
      display: block;
    }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 28px;
    }

    .header-logo {
      height: 34px;
      width: auto;
    }

    .header-meta {
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      flex-direction: column;
      gap: 4px;
      align-items: flex-end;
    }

    .header-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--brand-grey-dark);
    }

    h1, h2, h3 {
      font-family: var(--font-headline);
      color: var(--brand-grey-dark);
      margin: 0;
    }

    h1 { font-size: 30px; }
    h2 { font-size: 24px; margin-bottom: 12px; }
    h3 { font-size: 18px; margin-bottom: 8px; }

    p {
      margin: 0;
      line-height: 1.6;
      font-size: 13.5px;
      color: var(--text-body);
    }

    .muted {
      color: var(--text-muted);
    }

    .content-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px 20px;
      box-shadow: 0 6px 14px rgba(15, 23, 42, 0.05);
    }

    .section-spacing {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px 18px;
    }

    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .meta-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
    }

    .meta-value {
      font-size: 15px;
      font-weight: 500;
      color: var(--brand-grey-dark);
    }

    .paragraphs p + p {
      margin-top: 10px;
    }

    .toc-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 12px;
    }

    .toc-item {
      display: flex;
      align-items: baseline;
      gap: 12px;
      font-size: 14px;
      color: var(--brand-grey-dark);
    }

    .toc-number {
      font-weight: 600;
      width: 40px;
      font-variant-numeric: tabular-nums;
      color: var(--brand-red);
    }

    .toc-children {
      list-style: none;
      padding: 0;
      margin: 6px 0 0 52px;
      display: grid;
      gap: 6px;
      font-size: 13px;
      color: var(--text-muted);
    }

    .impressum-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px 20px;
    }

    .impressum-card {
      padding: 16px 18px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--surface-soft);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
    }

    .impressum-card h3 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      margin-bottom: 10px;
    }

    .impressum-card p {
      font-size: 13px;
      color: var(--text-body);
      margin: 4px 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
      color: var(--text-body);
    }

    .table-wrapper {
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      background: var(--surface);
    }

    thead th {
      background: #fff5f4;
      color: var(--brand-grey-dark);
      text-align: left;
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      border-bottom: 2px solid var(--brand-red);
    }

    tbody td {
      padding: 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }

    tbody tr:nth-child(even) {
      background: var(--surface-soft);
    }

    tbody tr:last-child td {
      border-bottom: none;
    }

    td.pos, th.pos {
      width: 42px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .cell-title {
      font-weight: 600;
      margin-bottom: 4px;
    }

    .cell-subtitle {
      font-size: 11.5px;
      color: var(--text-muted);
    }

    .foto-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(78px, 1fr));
      gap: 8px;
    }

    .foto-item {
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border);
      background: var(--surface);
    }

    .foto-item img {
      width: 100%;
      height: auto;
      display: block;
    }

    .empty-row td {
      text-align: center;
      color: var(--text-muted);
      font-style: italic;
      padding: 20px 12px;
    }

    .note {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 18px;
      line-height: 1.6;
    }

    .page-footer {
      margin-top: 24px;
      padding: 12px 24mm;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid var(--border);
      font-size: 11.5px;
      color: var(--text-muted);
    }

    .page-footer .footer-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .page-footer .footer-logo {
      height: 22px;
      width: auto;
    }

    .page-footer .footer-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .page-footer .page-number::before {
      content: "Seite ";
      font-weight: 500;
    }

    .page-footer .page-number::after {
      content: counter(page);
      font-weight: 600;
      color: var(--brand-grey-dark);
    }

    .page.cover .page-footer .page-number::before,
    .page.cover .page-footer .page-number::after {
      content: "";
    }

    .page.cover .page-footer {
      color: rgba(255, 255, 255, 0.72);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .page.cover .footer-logo {
      filter: brightness(1.2);
    }
  </style>
</head>
<body>
  <div class="page cover">
    <div class="page-inner">
      ${whiteLogo ? `<img class="cover-logo" src="${whiteLogo}" alt="Qualicasa" />` : ""}
      <div class="cover-headline">
        <div class="label">Qualitäts-Sicherung</div>
        <h1>${escapeHtml(objectName)}</h1>
        <div class="cover-subtitle">${escapeHtml(subtitle)}</div>
      </div>
      <div class="cover-meta">
        <div>
          <div class="cover-meta-label">Report-ID</div>
          <div class="cover-meta-value">${escapeHtml(reportId)}</div>
        </div>
        <div>
          <div class="cover-meta-label">Kunde</div>
          <div class="cover-meta-value">${escapeHtml(report.kunde?.name ?? "-")}</div>
        </div>
        <div>
          <div class="cover-meta-label">Objektadresse</div>
          <div class="cover-meta-value">${escapeHtml(buildLocation(report, true))}</div>
        </div>
        <div>
          <div class="cover-meta-label">Erstellt am</div>
          <div class="cover-meta-value">${escapeHtml(generatedAtStr)}</div>
        </div>
      </div>
      ${supersignLogo ? `<img class="cover-supersign" src="${supersignLogo}" alt="Qualicasa Supersign" />` : ""}
    </div>
    ${renderPageFooter(whiteLogo || primaryLogo, reportId, generatedAtStr, { hidePageNumber: true })}
  </div>

  <div class="page">
    <div class="page-inner">
      ${headerHtml}
      <section id="section-inhaltsverzeichnis" class="section-spacing">
        <h1>Inhaltsverzeichnis</h1>
        ${tocHtml}
      </section>
      <section class="section-spacing">
        <h2>Impressum</h2>
        ${impressumHtml}
      </section>
      ${titleImg ? `<div class="content-card" style="margin-top: 24px;"><img src="${escapeHtml(titleImg)}" alt="Titelbild" style="width: 100%; height: auto; display: block; border-radius: 12px;" /></div>` : ""}
    </div>
    ${renderPageFooter(primaryLogo || whiteLogo, reportId, generatedAtStr)}
  </div>

  <div class="page">
    <div class="page-inner">
      ${headerHtml}
      <section class="section-spacing">
        <h1 id="section-zusammenfassung">1. Zusammenfassung</h1>
        ${summaryHtml}
      </section>
      <section class="section-spacing">
        <h2>Objekt- und Kundendaten</h2>
        ${metaGridHtml}
        ${teilnehmerNote}
      </section>
    </div>
    ${renderPageFooter(primaryLogo || whiteLogo, reportId, generatedAtStr)}
  </div>

  <div class="page">
    <div class="page-inner">
      ${headerHtml}
      <section class="section-spacing">
        <h1 id="section-baurundgang">2. Baurundgang</h1>
        <div class="content-card">
          <h2 id="section-baurundgang-details">2.1 Details / Problembereiche</h2>
          <div class="table-wrapper">
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
                ${positionsBody}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
    ${renderPageFooter(primaryLogo || whiteLogo, reportId, generatedAtStr)}
  </div>

  <div class="page">
    <div class="page-inner">
      ${headerHtml}
      <section class="section-spacing">
        <h1 id="section-pruefprotokoll">3. Prüfprotokoll / Unterlagen</h1>
        <div class="content-card">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th class="pos">Pos</th>
                  <th>Status</th>
                  <th>Frist</th>
                  <th>Erledigt</th>
                  <th>Bemerkung</th>
                </tr>
              </thead>
              <tbody>
                ${pruefBody}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section class="section-spacing">
        <h1 id="section-diverses">4. Diverses</h1>
        ${diversHtml}
      </section>
    </div>
    ${renderPageFooter(primaryLogo || whiteLogo, reportId, generatedAtStr)}
  </div>
</body>
</html>`;
}

function renderPageHeader(logo, objectName, subtitle, reportId, generatedAtStr) {
  const safeSubtitle = subtitle ? escapeHtml(subtitle) : "";
  const metaLines = [
    generatedAtStr && generatedAtStr !== "-" ? `Erstellt am ${escapeHtml(generatedAtStr)}` : null,
    escapeHtml(reportId),
  ].filter(Boolean);

  return `<header class="page-header">
    <div>
      ${logo ? `<img class="header-logo" src="${logo}" alt="Qualicasa" />` : ""}
    </div>
    <div class="header-meta">
      <div class="header-title">${escapeHtml(objectName)}</div>
      ${safeSubtitle ? `<div>${safeSubtitle}</div>` : ""}
      ${metaLines.map((line) => `<div>${line}</div>`).join("")}
    </div>
  </header>`;
}

function renderPageFooter(logo, reportId, generatedAtStr, { hidePageNumber = false } = {}) {
  const generatedText = generatedAtStr && generatedAtStr !== "-" ? `Erstellt am ${escapeHtml(generatedAtStr)}` : null;
  return `<footer class="page-footer">
    <div class="footer-left">
      ${logo ? `<img class="footer-logo" src="${logo}" alt="Qualicasa" />` : ""}
      <span>${escapeHtml(reportId)}</span>
    </div>
    <div class="footer-right">
      ${generatedText ? `<span>${generatedText}</span>` : ""}
      ${hidePageNumber ? "" : '<span class="page-number"></span>'}
    </div>
  </footer>`;
}

function buildMetaEntries(report, reportId, reportDateStr) {
  const entries = [
    { label: "Report-ID", value: reportId },
    { label: "Baurundgang", value: reportDateStr !== "-" ? reportDateStr : "Keine Angabe" },
    { label: "Kunde", value: report.kunde?.name },
    { label: "Objekt", value: report.objekt?.bezeichnung },
    { label: "Objekttyp", value: report.objekttyp?.bezeichnung },
    { label: "Adresse", value: buildLocation(report) },
  ];

  if (report.projektleiter) {
    entries.push({
      label: "Projektleiter",
      value: [
        report.projektleiter.name,
        report.projektleiter.email,
        report.projektleiter.telefon,
      ]
        .filter(Boolean)
        .join(" · ") || undefined,
    });
  }

  if (report.kontakt) {
    entries.push({
      label: "Ansprechperson",
      value: [report.kontakt.name, report.kontakt.email, report.kontakt.telefon]
        .filter(Boolean)
        .join(" · ") || undefined,
    });
  }

  return entries.filter((entry) => entry.value);
}

function renderMetaGrid(entries) {
  if (!entries.length) {
    return '<p class="muted">Keine Stammdaten vorhanden.</p>';
  }

  return `<div class="meta-grid">
    ${entries
      .map(
        (entry) => `<div class="meta-item">
        <span class="meta-label">${escapeHtml(entry.label)}</span>
        <span class="meta-value">${escapeHtml(entry.value)}</span>
      </div>`
      )
      .join("\n    ")}
  </div>`;
}

function renderParagraphs(text) {
  if (!text) {
    return '<p class="muted">Keine Angaben vorhanden.</p>';
  }

  const paragraphs = Array.isArray(text)
    ? text
    : String(text)
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);

  if (!paragraphs.length) {
    return '<p class="muted">Keine Angaben vorhanden.</p>';
  }

  return `<div class="paragraphs">
    ${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n    ")}
  </div>`;
}

function renderToc(structure) {
  return `<ul class="toc-list">
    ${structure
      .map((item) => {
        const children = item.children?.length
          ? `<ul class="toc-children">
              ${item.children
                .map(
                  (child) => `<li><a href="#${child.target}"><span class="toc-number">${escapeHtml(
                    child.number
                  )}</span>${escapeHtml(child.title)}</a></li>`
                )
                .join("\n              ")}
            </ul>`
          : "";

        return `<li class="toc-item">
          <a href="#${item.target}">
            <span class="toc-number">${escapeHtml(item.number)}</span>
            ${escapeHtml(item.title)}
          </a>
          ${children}
        </li>`;
      })
      .join("\n    ")}
  </ul>`;
}

function renderImpressum(report) {
  const companyInfo = [
    "Qualicasa AG",
    "Schaffhauserstrasse 550",
    "8052 Zürich",
    "Schweiz",
  ];

  const contactLines = [
    "Telefon +41 44 552 55 55",
    "info@qualicasa.ch",
    "www.qualicasa.ch",
  ];

  const projektleiter = report.projektleiter
    ? [
        report.projektleiter.name,
        report.projektleiter.email,
        report.projektleiter.telefon,
      ].filter(Boolean)
    : [];

  return `<div class="impressum-grid">
    <div class="impressum-card">
      <h3>Qualicasa</h3>
      ${companyInfo.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
    </div>
    <div class="impressum-card">
      <h3>Kontakt</h3>
      ${contactLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
    </div>
    <div class="impressum-card">
      <h3>Verantwortlich</h3>
      ${projektleiter.length
        ? projektleiter.map((line) => `<p>${escapeHtml(line)}</p>`).join("")
        : '<p class="muted">Keine Angaben vorhanden.</p>'}
    </div>
  </div>`;
}

function renderTeilnehmer(report) {
  const teilnehmer = report.teilnehmer?.filter((t) => t?.kontakt)?.map((t) => t.kontakt) ?? [];
  if (!teilnehmer.length) return "";

  const listMarkup = teilnehmer
    .map((kontakt) => {
      const details = [kontakt.email, kontakt.telefon].filter(Boolean).join(" · ");
      return `<li><strong>${escapeHtml(kontakt.name)}</strong>${details ? ` – ${escapeHtml(details)}` : ""}</li>`;
    })
    .join("\n      ");

  return `<div class="content-card">
    <h3>Teilnehmer</h3>
    <ul>
      ${listMarkup}
    </ul>
  </div>`;
}

function buildLocation(report, includeCountry = false) {
  const parts = [report.objekt?.adresse, [report.objekt?.plz, report.objekt?.ort].filter(Boolean).join(" ")]
    .filter(Boolean)
    .map((s) => s.trim());

  if (includeCountry && report.objekt?.land) {
    parts.push(report.objekt.land);
  }

  return parts.length ? parts.join(" · ") : "-";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
