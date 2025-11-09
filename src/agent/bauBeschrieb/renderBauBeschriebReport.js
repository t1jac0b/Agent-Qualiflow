import { promises as fs } from "node:fs";
import path from "node:path";

const REPORT_ROOT = path.join(process.cwd(), "storage", "reports", "bau-beschrieb");

function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(dateLike) {
  const date = dateLike ? new Date(dateLike) : null;
  if (!date || Number.isNaN(date.getTime())) return "-";
  return date.toISOString().slice(0, 10);
}

export async function generateBauBeschriebReport({ kunde, objekt, objekttyp, ingestion, extracted }) {
  await fs.mkdir(REPORT_ROOT, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = objekt?.bezeichnung ? objekt.bezeichnung.replace(/[^a-z0-9-_]+/gi, "-") : "bau-beschrieb";
  const filename = `${baseName || "bau-beschrieb"}-${timestamp}.html`.toLowerCase();
  const filePath = path.join(REPORT_ROOT, filename);

  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <title>Bau-Beschrieb • ${escapeHtml(objekt?.bezeichnung ?? "")}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #1f2933; background: #f9fafb; }
    h1 { font-size: 28px; margin-bottom: 4px; }
    h2 { margin-top: 32px; color: #111827; }
    p { margin: 4px 0; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px 24px; }
    .card { background: #fff; border-radius: 12px; padding: 18px 22px; box-shadow: 0 10px 25px rgba(17, 24, 39, 0.08); border: 1px solid #e5e7eb; }
    .label { text-transform: uppercase; font-size: 11px; letter-spacing: 0.12em; color: #6b7280; margin-bottom: 6px; }
    .value { font-size: 16px; font-weight: 600; color: #111827; }
    table { border-collapse: collapse; margin-top: 18px; width: 100%; }
    th, td { text-align: left; padding: 10px 12px; }
    th { background: #f3f4f6; text-transform: uppercase; font-size: 12px; letter-spacing: 0.08em; color: #6b7280; }
    tr:nth-child(even) td { background: rgba(249, 250, 251, 0.6); }
    .badge { display: inline-block; background: #fee2e2; color: #b91c1c; border-radius: 999px; padding: 2px 10px; font-size: 12px; margin-top: 6px; }
    .muted { color: #6b7280; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(objekt?.bezeichnung ?? "Bau-Beschrieb")}</h1>
    <p class="muted">Erstellt am ${formatDate(new Date())}</p>
  </header>

  <section class="card">
    <div class="label">Kunde</div>
    <div class="value">${escapeHtml(kunde?.name ?? "-")}</div>
    <p>${escapeHtml([kunde?.adresse, `${kunde?.plz ?? ""} ${kunde?.ort ?? ""}`.trim()].filter(Boolean).join(", ")) || "-"}</p>
  </section>

  <section class="card" style="margin-top: 18px;">
    <div class="label">Objekt</div>
    <div class="value">${escapeHtml(objekt?.bezeichnung ?? "-")}</div>
    <p>${escapeHtml([objekt?.adresse, `${objekt?.plz ?? ""} ${objekt?.ort ?? ""}`.trim()].filter(Boolean).join(", ")) || "-"}</p>
    <p class="muted">Objekttyp: ${escapeHtml(objekttyp?.bezeichnung ?? objekttyp ?? "-")}</p>
    ${objekt?.notiz ? `<span class="badge">${escapeHtml(objekt.notiz).replace(/\n/g, "<br />")}</span>` : ""}
  </section>

  <section>
    <h2>Zusammenfassung</h2>
    <table>
      <thead>
        <tr>
          <th>Kriterium</th>
          <th>Wert</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Erstellungsjahr</td>
          <td>${escapeHtml(objekt?.erstellungsjahr ?? "-")}</td>
        </tr>
        <tr>
          <td>Wohneinheiten</td>
          <td>${escapeHtml(extracted?.objekt?.notiz?.match(/Wohneinheiten: (.*)/)?.[1] ?? "-")}</td>
        </tr>
        <tr>
          <td>Gewerberäume</td>
          <td>${escapeHtml(extracted?.objekt?.notiz?.match(/Gewerberäume: (.*)/)?.[1] ?? "-")}</td>
        </tr>
        <tr>
          <td>Upload-Pfad</td>
          <td>${escapeHtml(ingestion?.storedPath ?? "-")}</td>
        </tr>
      </tbody>
    </table>
  </section>
</body>
</html>`;

  await fs.writeFile(filePath, html, "utf8");
  return filePath;
}
