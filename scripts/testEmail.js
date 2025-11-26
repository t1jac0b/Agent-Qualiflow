import { config as loadEnv } from "dotenv";
import { mailTool } from "../src/agent/tools/mailTool.js";

loadEnv();

async function sendTestEmail() {
  console.log("[Test] Sende Test-E-Mail...");

  const recipient = "tinon.jacob@qualicasa.ch";
  const subject = "Test: QualiFlow Reminder System";
  const body = `Hallo,

Dies ist eine Test-E-Mail vom QualiFlow Reminder System.

Das System wurde erfolgreich konfiguriert und kann jetzt automatisch Erinnerungen versenden für:
• Offene Rückmeldungen mit fälliger Frist
• Überfällige Positionen im QS-Report
• Tägliche Reminder-Benachrichtigungen

Systemdetails:
• Erstellt am: ${new Date().toLocaleString("de-CH")}
• SMTP Host: ${process.env.SMTP_HOST}
• SMTP User: ${process.env.SMTP_USER}
• Mail enabled: ${process.env.MAIL_SEND_ENABLED}

Freundliche Grüsse,
QualiFlow Agent`;

  try {
    const result = await mailTool.actions.queueReminder({
      to: recipient,
      subject,
      body,
      meta: {
        testMail: true,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[Test] E-Mail Status: ${result.status}`);
    console.log(`[Test] Empfänger: ${result.to.join(", ")}`);
    console.log(`[Test] Queue-Datei: ${result.path}`);
    
    if (result.emailSent) {
      console.log("✓ [Test] E-Mail erfolgreich versendet!");
    } else if (result.emailError) {
      console.error(`✗ [Test] E-Mail-Versand fehlgeschlagen: ${result.emailError}`);
    } else {
      console.log("ℹ [Test] E-Mail in Queue gespeichert (SMTP nicht aktiviert)");
    }

    return result;
  } catch (error) {
    console.error("[Test] Fehler beim E-Mail-Versand:", error);
    throw error;
  }
}

sendTestEmail()
  .then(() => {
    console.log("\n[Test] Test abgeschlossen.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n[Test] Test fehlgeschlagen:", error);
    process.exit(1);
  });
