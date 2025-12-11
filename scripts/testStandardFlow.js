import { config as loadEnv } from "dotenv";

import { DatabaseTool } from "../src/tools/DatabaseTool.js";
import { ReportAgent } from "../src/agent/report/ReportAgent.js";
import { mailTool } from "../src/agent/tools/mailTool.js";

loadEnv();

const DAY_MS = 24 * 60 * 60 * 1000;

function logSection(title, payload) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(payload, null, 2));
}

function svgDataUri(label = "E2E", color = "#e94e44") {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="400" height="260">
    <rect x="0" y="0" width="400" height="260" fill="${color}"/>
    <text x="200" y="130" fill="#fff" font-size="28" text-anchor="middle" alignment-baseline="middle" font-family="Arial, Helvetica, sans-serif">${label}</text>
  </svg>`;
  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

async function main() {
  console.log("[E2E] Standardflow (Variante B) gestartet");
  const db = DatabaseTool;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const kundeName = `E2E Testkunde ${timestamp}`;
  const objektName = `E2E Testobjekt ${timestamp}`;

  // 1) Kunde, Objekttyp, Projektleiter anlegen
  const kunde = await db.ensureKunde({
    name: kundeName,
    adresse: "Teststrasse 1",
    plz: "8000",
    ort: "Zürich",
  });

  const objekttyp = await db.ensureObjekttyp("E2E Testobjekttyp");

  const projektleiter = await db.ensureProjektleiter({
    name: "E2E Projektleiter",
    email: "e2e.projektleiter@example.com",
    telefon: "+41 44 000 00 00",
  });

  const objekt = await db.createObjektForKunde({
    kundeId: kunde.id,
    bezeichnung: objektName,
    adresse: "Teststrasse 1",
    plz: "8000",
    ort: "Zürich",
    objekttypId: objekttyp?.id ?? null,
    projektleiterId: projektleiter.id,
  });

  logSection("Kunde/Objekt", {
    kunde: { id: kunde.id, name: kunde.name },
    objekt: { id: objekt.id, bezeichnung: objekt.bezeichnung },
  });

  // 2) Standard-Baurundgänge sicherstellen und passenden auswählen
  await db.autoCreateBaurundgaengeForObjekt(objekt.id);
  const baurundgaenge = await db.listBaurundgaengeByObjekt(objekt.id);
  if (!baurundgaenge.length) {
    throw new Error("Es wurden keine Baurundgänge für das Testobjekt angelegt.");
  }

  const preferName = "Bodenplatte, Dichtigkeitsklasse";
  let baurundgang =
    baurundgaenge.find((br) => (br.typ?.name ?? "").toLowerCase() === preferName.toLowerCase()) ?? baurundgaenge[0];

  logSection("Baurundgang", {
    id: baurundgang.id,
    typ: baurundgang.typ?.name ?? null,
    status: baurundgang.status,
  });

  // 3) QS-Report sicherstellen
  const report = await db.ensureQsReportForBaurundgang({
    baurundgangId: baurundgang.id,
    kundeId: kunde.id,
    objektId: objekt.id,
  });

  logSection("QS-Report", { id: report.id, baurundgangId: baurundgang.id });

  // 4) Bauteil-/Kapitel-Templates und Rückmeldungstypen laden
  const bauteile = await db.listBauteilTemplates();
  if (!bauteile.length) {
    throw new Error("Keine Bauteil-Templates vorhanden (Seed erforderlich).");
  }

  const pickTemplateByName = (arr, q) => arr.find((t) => (t.name ?? "").toLowerCase().includes(q.toLowerCase()));

  const tplA = pickTemplateByName(bauteile, "Fassade") || bauteile[0];
  const tplB = pickTemplateByName(bauteile, "Flachdach") || bauteile.find((t) => t.id !== tplA.id) || bauteile[0];

  const kapitelA = await db.listKapitelTemplatesByBauteilTemplate(tplA.id);
  const kapitelB = await db.listKapitelTemplatesByBauteilTemplate(tplB.id);
  if (!kapitelA.length || !kapitelB.length) {
    throw new Error("Kapitel-Templates für ausgewählte Bauteile fehlen.");
  }

  const kapA = kapitelA[0];
  const kapB = kapitelB[0];

  const rueckmeldungen = await db.listRueckmeldungstypen();
  if (!rueckmeldungen.length) {
    throw new Error("Keine Rückmeldungstypen vorhanden (Seed erforderlich).");
  }

  const rmPrimary = rueckmeldungen[0]?.id;
  const rmSecondary = rueckmeldungen[1]?.id ?? rmPrimary;

  // 5) Zwei Positionen mit Defaults und Fotos anlegen
  const p1 = await db.createPositionWithDefaults({
    baurundgangId: baurundgang.id,
    qsreportId: report.id,
    bauteilTemplateId: tplA.id,
    kapitelTemplateId: kapA.id,
    rueckmeldungstypIds: [rmPrimary, rmSecondary].filter(Boolean),
    bemerkung: "E2E Position 1",
  });

  const foto1 = await db.addFoto({
    baurundgang: { connect: { id: baurundgang.id } },
    dateiURL: svgDataUri("E2E Pos1", "#e94e44"),
  });
  await db.linkPositionFoto(p1.id, foto1.id);

  const p2 = await db.createPositionWithDefaults({
    baurundgangId: baurundgang.id,
    qsreportId: report.id,
    bauteilTemplateId: tplB.id,
    kapitelTemplateId: kapB.id,
    rueckmeldungstypIds: [rmPrimary].filter(Boolean),
    bemerkung: "E2E Position 2",
  });

  const foto2 = await db.addFoto({
    baurundgang: { connect: { id: baurundgang.id } },
    dateiURL: svgDataUri("E2E Pos2", "#4b5563"),
  });
  await db.linkPositionFoto(p2.id, foto2.id);

  logSection("Positionen", {
    p1: { id: p1.id },
    p2: { id: p2.id },
  });

  // 6) Report generieren (PDF)
  const reportAgent = new ReportAgent({ tools: { database: { actions: db } } });
  const gen = await reportAgent.handleReportGenerate({ qsReportId: report.id });
  if (gen?.status !== "SUCCESS") {
    throw new Error(`[E2E] Report-Generierung fehlgeschlagen: ${gen?.message}`);
  }

  logSection("Report-PDF", {
    status: gen.status,
    pdfPath: gen.pdfPath,
    downloadUrl: gen.downloadUrl,
  });

  // 7) Automatisches Nachfassen: Position überfällig setzen und Reminder auslösen
  const overdueFrist = new Date(Date.now() - 3 * DAY_MS);
  await db.updatePositionFields({
    id: p1.id,
    data: {
      erledigt: false,
      frist: overdueFrist,
    },
  });

  const subject = `E2E Reminder: Rückmeldung offen (Pos ${p1.positionsnummer ?? p1.id})`;
  const body = [
    "Guten Tag,",
    "",
    `Dies ist ein E2E-Test-Reminder für eine offene QS-Position (ID ${p1.id}) im QS-Report ${report.id}.`,
    "Bitte diese Nachricht ignorieren – sie stammt aus einem Testlauf.",
    "",
    "Freundliche Grüsse",
    "QualiFlow Agent (E2E-Test)",
  ].join("\n");

  const recipients = [projektleiter.email].filter(Boolean);
  if (!recipients.length) {
    throw new Error("Kein Empfänger für Reminder gefunden (Projektleiter ohne E-Mail).");
  }

  const queued = await mailTool.actions.queueReminder({
    to: recipients,
    subject,
    body,
    meta: {
      positionId: p1.id,
      qsreportId: report.id,
      baurundgangId: baurundgang.id,
    },
  });

  const nextReminderAt = new Date(Date.now() + 7 * DAY_MS);
  await db.recordReminderDispatch({
    positionId: p1.id,
    channel: "email",
    payload: queued,
    sentAt: new Date(),
    nextReminderAt,
    status: "sent",
  });

  const prisma = db.client;
  const reminders = await prisma.positionReminder.findMany({
    where: { positionId: p1.id },
    orderBy: { createdAt: "desc" },
    take: 1,
  });

  if (!reminders.length) {
    throw new Error("Es wurde kein Reminder-Datensatz für die Testposition gefunden.");
  }

  logSection("Reminder", {
    recipients,
    queued,
    latestReminder: reminders[0],
  });

  console.log("\n[E2E] SUCCESS – Standardprozess (Kunde → Objekt → Baurundgang → Positionen → Report → Reminder) erfolgreich durchlaufen.");
}

main().catch((error) => {
  console.error("\n[E2E] FAILED:", error?.message || error);
  if (error?.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
