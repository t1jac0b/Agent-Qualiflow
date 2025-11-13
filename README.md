# Agent-Qualiflow

## Überblick

Agent-Qualiflow stellt eine modulare Agenten-Architektur für Bau- und Qualitätsberichte bereit. Der Fokus liegt aktuell auf dem Backend-Stack, der später über einen Chatbot angesteuert wird. Wichtige Bausteine:

- **Agent-Orchestrierung**: `AgentOrchestrator` in `src/agent/AgentOrchestrator.js` registriert Sub-Agenten und injiziert die Tool-Schicht.
- **Sub-Agenten**: Der `ReportAgent` (``src/agent/report/ReportAgent.js``) kapselt Bau-Beschrieb-spezifische Fähigkeiten (`bauBeschrieb.upload`, `bauBeschrieb.finalize`). Weitere Sub-Agenten können analog hinterlegt werden.
- **Tool Layer**: Einheitliche Schnittstelle für Datenbank (`DatabaseTool`), Dateiverwaltung (`FileTool`), Mail (`MailTool`) und Report-Erzeugung (`ReportTool`) unter `src/agent/tools/`.
- **Session Handling**: `src/agent/chat/sessionStore.js` hält Konversationskontext bis zur Finalisierung.

## Schnellstart

1. **Abhängigkeiten installieren**
   ```powershell
   npm install
   npx playwright install chromium # Für PDF-Export via Report-Agent
   ```

2. **Environment konfigurieren**
   - `.env` anlegen und `DATABASE_URL` (sowie optional `SHADOW_DATABASE_URL`) auf die Ziel-Postgres-Instanz setzen.
   - Für lokale Tests kann die Seed-Datei genutzt werden:
     ```powershell
     npm run prisma:seed
     ```

3. **Agenten-Server starten**
   ```powershell
   npm run chat:server
   ```
   Der Server lauscht standardmäßig auf Port `3001` (überschreibbar via `CHAT_SERVER_PORT`).

4. **QS-Report generieren (Beispiel)**
   ```powershell
   Invoke-WebRequest -Uri http://localhost:3001/qs-rundgang/1/report
   ```
   Die PDF wird unter `storage/reports/qs/` abgelegt und der Pfad in der Response zurückgegeben.

## Bau-Beschrieb Flow

1. **Upload** (`bauBeschrieb.upload`)
   - PDF wird gespeichert (`storage/uploads-bau-beschrieb/…`).
   - Text wird extrahiert (via `pdf-parse`) und Metadaten werden analysiert.
   - Pflichtfelder (`Kunde`, `Adresse`, `PLZ`, `Ort`, `Objekttyp`, `Projektleiter`) werden geprüft.
   - Fehlende Angaben werden als `pendingFields` zurückgegeben.

2. **Finalisierung** (`bauBeschrieb.finalize`)
   - Manuelle Overrides (z. B. Projektleiter) werden gemerged.
   - Falls weiterhin Pflichtfelder fehlen, bleibt der Status `needs_input`.
   - Bei vollständigen Informationen: Persistierung in Prisma (Kunde, Objekt, Objekttyp) und HTML-Report unter `storage/reports/bau-beschrieb/…`.

### Chat Attachment Workflow

- Der Endpoint `POST /chat/upload` speichert Dateien im Bucket `storage/chat-uploads/<chatId>/` und registriert den Anhang beim `LLMOrchestrator`.
- Über die neuen LLM-Tools kann der Agent Anhänge inspizieren (`list_pending_attachments`), Bau-Beschriebe verarbeiten (`process_baubeschrieb_attachment`) und finalisieren (`finalize_baubeschrieb_attachment`).
- Nach der Verarbeitung werden Kontextfelder (`kunde`, `objekt`, `projektleiter`, `pendingRequirements`) automatisch aktualisiert. Fehlende Pflichtfelder erscheinen im UI als Liste.
- Bei erfolgreicher Finalisierung wird der Anhang aus dem Pending-Stack entfernt und der Kontext bereinigt.

### UI-Hinweise für Pflichtfelder

- Das Chat-Frontend zeigt unter jeder Agent-Antwort offene Pflichtfelder an (z. B. `projektleiter`).
- Projektleiterdaten lassen sich komfortabel über natürliche Texteingaben wie `Projektleiter: Max Beispiel` oder `Projektleiter E-Mail: max@example.com` ergänzen.
- Gespeicherte Uploads werden unterhalb der Nachricht mit Dateiname markiert, sodass der Nutzer weiß, dass die Datei registriert ist.

### Automatisches Nachfassen (Reminder)

- Offene Rückmeldungen können automatisiert per E-Mail erinnert werden.
- Befehl: `npm run reminders:send` (verwendet `scripts/sendReminders.js`).
- Der Job nutzt die neuen Felder an `Position` (`reminderAt`, `reminderSentAt`, `reminderCount`) sowie die Tabelle `PositionReminder`.
- E-Mails werden als JSON-Dateien im Verzeichnis `storage/mail/reminders/` abgelegt (`MAIL_OUTBOX_DIR` konfigurierbar) und können von externen Prozessen gesendet werden.
- Konfiguration über Umgebungsvariablen:
  - `REMINDER_INTERVAL_DAYS` (Standard 7 Tage) – legt fest, wann der nächste Reminder geplant wird.
  - `REMINDER_MAX_COUNT` (Standard 5) – begrenzt die Anzahl Erinnerungen pro Position.
  - `REMINDER_INCLUDE_COMPLETED` (optional) – prüft auch erledigte Positionen, falls `true`.
  - `REMINDER_DUE_BEFORE` – ISO-Datum/Zeit für benutzerdefinierten Stichtag.
- Ein Cronjob oder Task Scheduler kann den Befehl periodisch ausführen (z. B. täglich um 06:00 Uhr).

## CLI: Chat Flow testen

Simuliere den Chatbot-Ablauf via CLI:

```powershell
# 1) Upload, erwartet ggf. weitere Angaben (Status: needs_input)
node scripts/testChatFlow.js "C:\Pfad\zu\bau-beschrieb.pdf"

# 2) Upload + Follow-up in einem Schritt (Projektleiter-Angabe etc.)
node scripts/testChatFlow.js "C:\Pfad\zu\bau-beschrieb.pdf" "Projektleiter: Max Beispiel"
```

Hinweise:

- Wird der Projektleiter nicht im PDF gefunden, muss er als Follow-up nachgereicht werden (Pflichtfeld).
- Powershell interpretiert spitze Klammern (`<…>`) als Redirection; daher Pfade ohne Klammern angeben.

### Interaktiver Chat (Konsole)

Für einen kontinuierlichen Testlauf steht ein interaktives CLI bereit:

```powershell
node scripts/chatConsole.js
```

Im Prompt stehen folgende Kommandos zur Verfügung:

- `/upload <pfad-zur-pdf>` – lädt einen Bau-Beschrieb hoch.
- `/help` – zeigt verfügbare Befehle an.
- `/quit` – beendet die Sitzung.

Normale Texteingaben werden als Chat-Messages interpretiert, z. B. `Projektleiter: Max Beispiel`.

### HTTP Chat-Server

Zum Testen aus Frontend- oder API-Clients steht ein leichter HTTP-Server bereit:

```powershell
npm run chat:server
```

Endpoints (Standard-Port `3001`, konfigurierbar via `CHAT_SERVER_PORT`):

- `POST /chat/upload` – Multipart-Upload (`file` Feld) für Bau-Beschrieb-PDFs. Optional `chatId` übergeben.
  - Unterstützt optionale Felder `message`, `projektleiter`, `projektleiter_email`, `projektleiter_telefon`; wenn ausgefüllt, wird automatisch eine Folge-Nachricht gesendet.
- `POST /chat/message` – JSON-Body `{ chatId, message }` für Folge-Nachrichten.
- `GET /health` – einfacher Health-Check.

Antworten enthalten `status`, `message` und `context`, identisch zum CLI-Verhalten.

**Beispiele:**

- PowerShell (Empfehlung, nutzt `Invoke-RestMethod`):
  ```powershell
  # Upload + Projektleiter in einem Schritt
  Invoke-RestMethod `
    -Uri "http://localhost:3001/chat/upload" `
    -Method Post `
    -Form @{
      file = Get-Item 'C:\Users\tinon\Downloads\Baubeschrieb.pdf'
      projektleiter = 'Max Beispiel'
      projektleiter_email = 'max.beispiel@example.com'
      projektleiter_telefon = '+41 31 000 00 00'
    }
  ```

  ```powershell
  # Folge-Nachricht
  Invoke-RestMethod `
    -Uri "http://localhost:3001/chat/message" `
    -Method Post `
    -ContentType "application/json" `
    -Body (@{ chatId = 'chat-…'; message = 'Projektleiter: Max Beispiel' } | ConvertTo-Json)
  ```

- `curl` (Git Bash / WSL):
  ```bash
  curl -F "file=@/path/to/Baubeschrieb.pdf" \
       -F "projektleiter=Max Beispiel" \
       -F "projektleiter_email=max.beispiel@example.com" \
       -F "projektleiter_telefon=+41 31 000 00 00" \
       http://localhost:3001/chat/upload
  ```

## Tests & Entwicklung

- **Unit Tests**: `npm test`
- Enthält u. a. `test/llmOrchestrator.attachments.test.js` für Upload- und Finalisierungsszenarien.
- Enthält `test/mailTool.queueReminder.test.js` zur Verifizierung der Reminder-Queue.
- **Prisma Seed**: `npm run prisma:seed`
- Prisma-Middleware-Hook (`instantiateFromTemplate`) wird im Test-Kontext deaktiviert, wenn `$use` nicht verfügbar ist.

## Offene Follow-ups

- Automatische E-Mail-Benachrichtigung bei fehlenden Pflichtfeldern (derzeit nur UI-Hinweis).
- Erweiterte Validierung der Projektleiterdaten (Validierung auf korrekte Telefonnummer/E-Mail steht noch aus).
- End-to-End-Tests für das Browser-Frontend (aktueller Fokus auf Unit Tests).

## Git-Workflow

- Arbeite auf Feature-Branches (z. B. `feat/agent-architecture`).
- Änderungen vor dem Commit über `git status` prüfen.
- Commit & Push Beispiel:

```powershell
git add .
git status
git commit -m "Beschreibung der Änderung"
git push origin <branch>