// In: src/render/ReportRenderer.js

export function formatDateISO(d) {
  if (!d) return "-";
  try {
    const dd = typeof d === "string" ? new Date(d) : d;
    return dd.toISOString().slice(0, 10);
  } catch {
    return String(d);
  }
}

export function renderMarkdown(report) {
  const lines = [];

  // Title pattern: QS-Report X: Baurundgang vom – (Datum)
  const date = report.baurundgang?.datumDurchgefuehrt ?? report.baurundgang?.datumGeplant;
  const dateStr = formatDateISO(date);
  lines.push(`# QS-Report ${report.id}: Baurundgang vom ${dateStr}`);
  lines.push("");

  // Cover: Stammdaten + Titelbild
  lines.push("## Objekt- und Kundendaten");
  lines.push("");
  lines.push(`- Kunde: ${report.kunde?.name ?? "-"}`);
  lines.push(`- Objekt: ${report.objekt?.bezeichnung ?? "-"}`);
  lines.push(`- Objekttyp: ${report.objekttyp?.bezeichnung ?? "-"}`);
  lines.push(`- Adresse: ${report.objekt?.adresse ?? "-"}`);
  lines.push(`- PLZ/Ort: ${[report.objekt?.plz, report.objekt?.ort].filter(Boolean).join(" ") || "-"}`);
  if (report.kontakt?.name) lines.push(`- Ansprechperson: ${report.kontakt.name}`);
  lines.push("");

  const titleImg = report.titelbildURL || report.baurundgang?.fotos?.[0]?.dateiURL;
  if (titleImg) {
    lines.push(`![Titelbild](${titleImg})`);
    lines.push("");
  }

  // Seite 2: Zusammenfassung
  lines.push("## 1. Zusammenfassung");
  lines.push("");
  lines.push(report.zusammenfassung ? report.zusammenfassung : "-");
  lines.push("");

  // 2. Baurundgang: Positionen Tabelle
  lines.push("## 2. Baurundgang");
  lines.push("");
  lines.push("### 2.1 Details / Problembereiche");
  lines.push("");
  lines.push("| Pos | Bauteil/Bereich | Fotos | Aktion |");
  lines.push("| ---:| ---------------- | ----- | ------ |");
  for (const p of (report.positionen ?? [])) {
    const pos = p.positionsnummer ?? "-";
    const bauteil = p.bauteil?.template?.name || p.bauteil?.materialisierung?.name || p.bereichstitel || p.bereich?.name || "-";
    const fotos = (p.fotos ?? []).map(f => f.foto?.dateiURL).filter(Boolean);
    const fotosCell = fotos.length ? fotos.map((u, i) => `[F${i+1}](${u})`).join(" ") : "-";
    const aktion = `${p.rueckmeldungstyp?.name ?? ""}${p.bemerkung ? (p.rueckmeldungstyp?.name ? ": " : "") + p.bemerkung : ""}` || "-";
    lines.push(`| ${pos} | ${escapePipes(bauteil)} | ${fotosCell} | ${escapePipes(aktion)} |`);
  }
  lines.push("");

  // 3. Prüfprotokoll / Unterlagen
  lines.push("## 3. Prüfprotokoll / Unterlagen");
  lines.push("");
  lines.push("| Pos | Datum bis (Frist) | Datum erledigt | Bemerkung |");
  lines.push("| ---:| ------------------ | -------------- | --------- |");
  const pendenzen = (report.positionen ?? []).filter((p) => {
    const hasAction = !!p.rueckmeldungstyp;
    const hasFrist = !!p.frist;
    const open = p.erledigt === false;
    return hasAction || hasFrist || open;
  });
  for (const p of pendenzen) {
    const pos = p.positionsnummer ?? "-";
    const frist = formatDateISO(p.frist);
    const erledigt = formatDateISO(p.erledigtAm);
    const bemerkung = p.rueckmeldungBemerkung || p.bemerkung || "-";
    lines.push(`| ${pos} | ${frist} | ${erledigt} | ${escapePipes(bemerkung)} |`);
  }
  lines.push("");

  // 4. Diverses
  lines.push("## 4. Diverses");
  lines.push("");
  lines.push(report.diverses ? report.diverses : "-");
  lines.push("");

  return lines.join("\n");
}

function escapePipes(s) {
  return String(s).replaceAll("|", "\\|");
}
