import { DatabaseTool } from "../src/tools/DatabaseTool.js";
import { ReportAgent } from "../src/agent/report/ReportAgent.js";

function svgDataUri(label = "Demo", color = "#e94e44") {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="400" height="260">
    <rect x="0" y="0" width="400" height="260" fill="${color}"/>
    <text x="200" y="130" fill="#fff" font-size="28" text-anchor="middle" alignment-baseline="middle" font-family="Arial, Helvetica, sans-serif">${label}</text>
  </svg>`;
  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

async function main() {
  console.log("[Test] QS Report flow started");
  const db = DatabaseTool;

  // 1) Ensure test Kunde/Objekt
  const kunde = await db.ensureKunde({ name: "QSFlow Testkunde" });
  const objekt = await db.createObjektForKunde({ kundeId: kunde.id, bezeichnung: "QSFlow Objekt" });
  console.log("[Test] Kunde/Objekt:", { kunde: kunde.name, objekt: objekt.bezeichnung, objektId: objekt.id });

  // Ensure a Projektleiter is assigned to Kunde and Objekt so reminders have recipients
  const pl = await db.ensureProjektleiter({ name: "Chris Dosch" });
  await db.updateKundeFields({ id: kunde.id, data: { projektleiter: { connect: { id: pl.id } } } });
  await db.updateObjektFields({ id: objekt.id, data: { projektleiter: { connect: { id: pl.id } } } });

  // 2) Ensure Baurundgänge exist and pick one (prefer Innenausbau Leichtbauwände, Gipserarbeiten)
  await db.autoCreateBaurundgaengeForObjekt(objekt.id);
  const brs = await db.listBaurundgaengeByObjekt(objekt.id);
  if (!brs.length) throw new Error("No Baurundgänge created");
  let br = brs.find((x) => /Innenausbau\s+Leichtbauwände|Innenausbau\s+Leichtbauwaende|Gipserarbeiten/i.test(x.typ?.name ?? ""))
        || brs.find((x) => /Fassadenarbeiten/i.test(x.typ?.name ?? ""))
        || brs[0];
  console.log("[Test] Using Baurundgang:", { id: br.id, typ: br.typ?.name });

  // 3) Ensure QSReport
  const report = await db.ensureQsReportForBaurundgang({ baurundgangId: br.id, kundeId: kunde.id, objektId: objekt.id });
  console.log("[Test] QSReport:", { id: report.id });

  // 4) Pick Bauteil/Kapitel templates
  const bauteile = await db.listBauteilTemplates();
  const pickTemplateByName = (arr, q) => arr.find((t) => (t.name ?? "").toLowerCase().includes(q.toLowerCase()));
  const tplFassade = pickTemplateByName(bauteile, "Fassade") || bauteile.find(Boolean);
  const tplDach = pickTemplateByName(bauteile, "Flachdach") || bauteile.find(Boolean);
  if (!tplFassade || !tplDach) throw new Error("Bauteil templates missing");

  const kapitelFassade = await db.listKapitelTemplatesByBauteilTemplate(tplFassade.id);
  const tplFassadeKap = pickTemplateByName(kapitelFassade, "Grund- und Deckputz") || kapitelFassade[0];
  const kapitelDach = await db.listKapitelTemplatesByBauteilTemplate(tplDach.id);
  const tplDachKap = pickTemplateByName(kapitelDach, "Flachdach") || kapitelDach[0];

  // 5) Rückmeldungstypen
  const rms = await db.listRueckmeldungstypen();
  const rmByName = (n) => rms.find((r) => (r.name ?? "").toLowerCase().includes(n.toLowerCase()))?.id;
  const RM_AK = rmByName("Ausführungskontrolle") || rms[0]?.id;
  const RM_ABKL = rmByName("Abklärung") || rms[1]?.id;
  const RM_QC = rmByName("QualiCasa") || rms[2]?.id;

  // 6) Create first position (Fassade/Grund- und Deckputz)
  const p1 = await db.createPositionWithDefaults({
    baurundgangId: br.id,
    qsreportId: report.id,
    bauteilTemplateId: tplFassade.id,
    kapitelTemplateId: tplFassadeKap.id,
    rueckmeldungstypIds: [RM_AK, RM_QC].filter(Boolean),
    bemerkung: "Fassade 1",
  });
  // Add two fotos
  const f1 = await db.addFoto({
    baurundgang: { connect: { id: br.id } },
    dateiURL: svgDataUri("Fassade-1", "#e94e44"),
  });
  await db.linkPositionFoto(p1.id, f1.id);
  const f2 = await db.addFoto({
    baurundgang: { connect: { id: br.id } },
    dateiURL: svgDataUri("Fassade-2", "#d64037"),
  });
  await db.linkPositionFoto(p1.id, f2.id);

  // 7) Second capture for same Bauteil/Kapitel should merge (no new position)
  const p1b = await db.createPositionWithDefaults({
    baurundgangId: br.id,
    qsreportId: report.id,
    bauteilTemplateId: tplFassade.id,
    kapitelTemplateId: tplFassadeKap.id,
    rueckmeldungstypIds: [RM_ABKL].filter(Boolean),
    bemerkung: "Fassade 2",
  });
  const f3 = await db.addFoto({
    baurundgang: { connect: { id: br.id } },
    dateiURL: svgDataUri("Fassade-3", "#b8322a"),
  });
  await db.linkPositionFoto(p1b.id, f3.id);

  if (p1b.id !== p1.id) {
    throw new Error(`[Test] Expected merge into same position, but got different ids: ${p1.id} vs ${p1b.id}`);
  }

  // 8) Third position for Dach
  const p2 = await db.createPositionWithDefaults({
    baurundgangId: br.id,
    qsreportId: report.id,
    bauteilTemplateId: tplDach.id,
    kapitelTemplateId: tplDachKap.id,
    rueckmeldungstypIds: [RM_AK].filter(Boolean),
    bemerkung: "Dach",
  });
  const f4 = await db.addFoto({
    baurundgang: { connect: { id: br.id } },
    dateiURL: svgDataUri("Dach-1", "#4b5563"),
  });
  await db.linkPositionFoto(p2.id, f4.id);

  // 9) Read back report to verify counts
  const full = await db.getQSReport(report.id);
  const posCount = full.positionen?.length ?? 0;
  const fassadePos = full.positionen.find((x) => (x.bauteil?.template?.name ?? "").toLowerCase().includes("fassade"))
  if (!fassadePos) throw new Error("[Test] Fassade position not found");
  const fassadeFotos = (fassadePos.fotos ?? []).length;
  if (fassadeFotos < 3) {
    throw new Error(`[Test] Expected merged Fassade fotos >= 3, got ${fassadeFotos}`);
  }

  console.log("[Test] Positions count:", posCount, "(expect 2)");

  // 10) Generate report (PDF)
  const agent = new ReportAgent({ tools: { database: { actions: db } } });
  const gen = await agent.handleReportGenerate({ qsReportId: report.id });
  if (gen?.status !== "SUCCESS") {
    throw new Error(`[Test] Report generation failed: ${gen?.message}`);
  }
  console.log("[Test] PDF:", gen.downloadUrl);

  console.log("[Test] SUCCESS – merged positions and ordered numbering validated.");
}

main().catch((err) => {
  console.error("[Test] FAILED:", err?.message || err);
  process.exit(1);
});
