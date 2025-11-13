import { config as loadEnv } from "dotenv";

import { DatabaseTool } from "../src/tools/DatabaseTool.js";
import { mailTool } from "../src/agent/tools/mailTool.js";

loadEnv();

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_NEXT_REMINDER_DAYS = Number.parseInt(process.env.REMINDER_INTERVAL_DAYS ?? "7", 10);
const DEFAULT_MAX_REMINDERS = Number.parseInt(process.env.REMINDER_MAX_COUNT ?? "5", 10);
const INCLUDE_COMPLETED = process.env.REMINDER_INCLUDE_COMPLETED === "true";
const DUE_BEFORE = process.env.REMINDER_DUE_BEFORE ? new Date(process.env.REMINDER_DUE_BEFORE) : new Date();

function uniqueEmails(...lists) {
  const bucket = new Set();
  for (const list of lists) {
    if (!list) continue;
    const values = Array.isArray(list) ? list : [list];
    for (const value of values) {
      if (!value) continue;
      const trimmed = String(value).trim().toLowerCase();
      if (trimmed) bucket.add(trimmed);
    }
  }
  return Array.from(bucket);
}

function deriveRecipients(position) {
  const qs = position.qsreport ?? {};
  const kunde = qs.kunde ?? {};
  const objekt = qs.objekt ?? {};

  const primaryEmails = uniqueEmails(
    qs.projektleiter?.email,
    kunde.projektleiter?.email,
    objekt.projektleiter?.email,
    qs.kontakt?.email,
    kunde.kontakt?.email,
    objekt.kontakt?.email,
  );

  return primaryEmails;
}

function formatReminderBody(position) {
  const qs = position.qsreport ?? {};
  const kunde = qs.kunde ?? {};
  const objekt = qs.objekt ?? {};
  const baurundgang = qs.baurundgang ?? {};
  const rueckmeldung = position.rueckmeldungstyp?.name ?? "Rückmeldung";
  const frist = position.frist ? new Date(position.frist).toLocaleDateString("de-CH") : "keine Frist";

  return [
    `Guten Tag,`,
    "",
    `Für den QS-Report #${qs.id ?? "?"} (${objekt.bezeichnung ?? "Objekt"}, Kunde ${kunde.name ?? "?"}) ist noch eine Rückmeldung offen:`,
    `• Position ${position.positionsnummer ?? position.id}: ${rueckmeldung}`,
    position.bemerkung ? `• Hinweis: ${position.bemerkung}` : null,
    `• Frist: ${frist}`,
    baurundgang.typ?.name ? `• Baurundgang: ${baurundgang.typ.name}` : null,
    "",
    "Bitte die Rückmeldung erfassen oder uns entsprechenden Bescheid geben.",
    "",
    "Freundliche Grüsse", "QualiFlow Agent",
  ]
    .filter(Boolean)
    .join("\n");
}

async function queueReminderForPosition(position) {
  const recipients = deriveRecipients(position);
  if (!recipients.length) {
    console.warn(
      `[reminder] Keine Empfänger gefunden für Position ${position.id} (QS-Report ${position.qsreport?.id ?? "?"}). Überspringe.`,
    );
    return { skipped: true, reason: "no_recipients" };
  }

  const subject = `Reminder: Rückmeldung offen (Pos ${position.positionsnummer ?? position.id})`;
  const body = formatReminderBody(position);

  const queued = await mailTool.actions.queueReminder({
    to: recipients,
    subject,
    body,
    meta: {
      positionId: position.id,
      qsreportId: position.qsreport?.id ?? null,
      baurundgangId: position.qsreport?.baurundgang?.id ?? null,
    },
  });

  const nextReminderAt = new Date(Date.now() + DEFAULT_NEXT_REMINDER_DAYS * DAY_MS);

  await DatabaseTool.recordReminderDispatch({
    positionId: position.id,
    channel: "email",
    payload: queued,
    sentAt: new Date(),
    nextReminderAt,
    status: "sent",
  });

  return { skipped: false, queuedPath: queued.path, recipients };
}

async function run() {
  const positions = await DatabaseTool.listPendingRueckmeldungen({
    dueBefore: DUE_BEFORE,
    maxReminderCount: DEFAULT_MAX_REMINDERS,
    includeCompleted: INCLUDE_COMPLETED,
  });

  if (!positions.length) {
    console.log("[reminder] Keine offenen Rückmeldungen gefunden.");
    return;
  }

  console.log(`[reminder] Verarbeite ${positions.length} offene Position(en).`);

  let queued = 0;
  let skipped = 0;

  for (const position of positions) {
    try {
      const result = await queueReminderForPosition(position);
      if (result.skipped) {
        skipped += 1;
      } else {
        queued += 1;
        console.log(
          `[reminder] Queue erstellt für Position ${position.id} → ${result.recipients.join(", ")} (${result.queuedPath})`,
        );
      }
    } catch (error) {
      skipped += 1;
      console.error(`[reminder] Fehler bei Position ${position.id}:`, error);
    }
  }

  console.log(`[reminder] Zusammenfassung: ${queued} versendet, ${skipped} übersprungen.`);
}

run()
  .catch((error) => {
    console.error("[reminder] Unerwarteter Fehler:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await DatabaseTool.disconnect?.();
    } catch (error) {
      if (error) {
        console.warn("[reminder] Fehler beim Disconnect:", error);
      }
    }
  });
