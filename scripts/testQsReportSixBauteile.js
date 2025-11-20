import { DatabaseTool } from "../src/tools/DatabaseTool.js";
import { ReportAgent } from "../src/agent/report/ReportAgent.js";

function svgDataUri(label = "Demo", color = "#4b5563") {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="400" height="260">
    <rect x="0" y="0" width="400" height="260" fill="${color}"/>
    <text x="200" y="130" fill="#fff" font-size="28" text-anchor="middle" alignment-baseline="middle" font-family="Arial, Helvetica, sans-serif">${label}</text>
  </svg>`;
  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

function pickColor(index) {
  const palette = ["#e94e44", "#d64037", "#b8322a", "#4b5563", "#2563eb", "#16a34a", "#9333ea", "#f59e0b"];
  return palette[index % palette.length];
}

async function main() {
  console.log("[Test6] QS Report flow (6 Bauteile) started");
  const db = DatabaseTool;

  // 1) Ensure Kunde / Objekt
  const kunde = await db.ensureKunde({ name: "QSFlow Testkunde Six" });
  const uniqueSuffix = new Date().toISOString().replace(/[:.]/g, "-");
  const objekt = await db.createObjektForKunde({ kundeId: kunde.id, bezeichnung: `QSFlow Objekt Six ${uniqueSuffix}` });
  console.log("[Test6] Kunde/Objekt:", { kunde: kunde.name, objekt: objekt.bezeichnung, objektId: objekt.id });

  // 2) Ensure Baurundgang
  await db.autoCreateBaurundgaengeForObjekt(objekt.id);
  const baurundgaenge = await db.listBaurundgaengeByObjekt(objekt.id);
  if (!baurundgaenge.length) {
    throw new Error("[Test6] Keine Baurundgänge gefunden");
  }
  const br = baurundgaenge.find((x) => /Innenausbau/i.test(x.typ?.name ?? "")) || baurundgaenge[0];
  console.log("[Test6] Using Baurundgang:", { id: br.id, typ: br.typ?.name });

  // 3) Ensure QSReport
  const report = await db.ensureQsReportForBaurundgang({ baurundgangId: br.id, kundeId: kunde.id, objektId: objekt.id });
  console.log("[Test6] QSReport:", { id: report.id });

  // 4) Collect Bauteil Templates
  const bauteile = await db.listBauteilTemplates();
  if (!bauteile?.length) {
    throw new Error("[Test6] Keine Bauteil Templates gefunden");
  }
  const selectedTemplates = [];
  for (const tpl of bauteile) {
    const kapitelTemplates = await db.listKapitelTemplatesByBauteilTemplate(tpl.id);
    if (kapitelTemplates?.length) {
      selectedTemplates.push({ tpl, kapitelTemplates });
    }
    if (selectedTemplates.length === 6) break;
  }
  if (selectedTemplates.length < 6) {
    throw new Error(
      `[Test6] Erwartete mindestens 6 Bauteil-Templates mit Kapiteln, gefunden: ${selectedTemplates.length}`
    );
  }

  // 5) Rueckmeldungsarten ermitteln
  const rueckmeldungen = await db.listRueckmeldungstypen();
  const rmIds = (names) =>
    names
      .map((name) =>
        rueckmeldungen.find((rm) => (rm.name ?? "").toLowerCase().includes(name.toLowerCase()))?.id
      )
      .filter(Boolean);

  const rmSets = [
    rmIds(["Ausführung", "Quali"]),
    rmIds(["Quali"]),
    rmIds(["Abklärung"]),
    rmIds(["Ausführung"]),
    [],
    [],
  ];

  // 6) Create 6 Positions with varying photo counts
  const photoCounts = [1, 2, 3, 4, 1, 4];
  const createdPositions = [];

  for (let i = 0; i < selectedTemplates.length; i += 1) {
    const { tpl: bauteilTpl, kapitelTemplates } = selectedTemplates[i];
    const kapitelTpl = kapitelTemplates[0];

    const rueckmeldungstypIds = rmSets[i];
    const bemerkung = `Test Six Position ${i + 1}${rueckmeldungstypIds.length ? " (mit RM)" : " (ohne RM)"}`;

    const position = await db.createPositionWithDefaults({
      baurundgangId: br.id,
      qsreportId: report.id,
      bauteilTemplateId: bauteilTpl.id,
      kapitelTemplateId: kapitelTpl.id,
      rueckmeldungstypIds,
      bemerkung,
    });

    const photoTotal = photoCounts[i];
    for (let p = 0; p < photoTotal; p += 1) {
      const foto = await db.addFoto({
        baurundgang: { connect: { id: br.id } },
        dateiURL: svgDataUri(`Pos${i + 1}-Foto${p + 1}`, pickColor(i + p)),
      });
      await db.linkPositionFoto(position.id, foto.id);
    }

    createdPositions.push({ position, rueckmeldungstypIds, photoTotal, bauteil: bauteilTpl.name });
  }

  // 7) Prüf-Output
  const fullReport = await db.getQSReport(report.id);
  const totalPositions = fullReport.positionen?.length ?? 0;
  const withRueckmeldung = fullReport.positionen?.filter((pos) =>
    (pos.rueckmeldungen?.length ?? 0) > 0 || Boolean(pos.rueckmeldungstypId)
  )?.length ?? 0;

  console.log(`[Test6] Positionen gesamt: ${totalPositions}`);
  console.log(`[Test6] Positionen mit Rueckmeldungsart: ${withRueckmeldung}`);
  for (const info of createdPositions) {
    console.log(`  - ${info.bauteil}: Fotos ${info.photoTotal}, RM-Count ${info.rueckmeldungstypIds.length}`);
  }

  if (totalPositions !== 6) {
    throw new Error(`[Test6] Erwartete 6 Positionen, gefunden ${totalPositions}`);
  }
  if (withRueckmeldung !== 4) {
    throw new Error(`[Test6] Erwartete 4 Positionen mit Rueckmeldungsart, gefunden ${withRueckmeldung}`);
  }

  // 8) Report generieren
  const reportAgent = new ReportAgent({ tools: { database: { actions: db } } });
  const generated = await reportAgent.handleReportGenerate({ qsReportId: report.id });
  if (generated?.status !== "SUCCESS") {
    throw new Error(`[Test6] Report generation failed: ${generated?.message}`);
  }
  console.log(`[Test6] PDF: ${generated.downloadUrl}`);

  console.log("[Test6] SUCCESS – 6 Bauteile mit variablen Fotos und Rueckmeldungsarten getestet.");
}

main().catch((error) => {
  console.error("[Test6] FAILED:", error?.message ?? error);
  process.exit(1);
});
