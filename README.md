# Agent-Qualiflow

## Überblick

Agent-Qualiflow stellt eine modulare Agenten-Architektur für Bau- und Qualitätsberichte bereit. Der Fokus liegt aktuell auf dem Backend-Stack, der später über einen Chatbot angesteuert wird. Wichtige Bausteine:

- **Agent-Orchestrierung**: `AgentOrchestrator` in `src/agent/AgentOrchestrator.js` registriert Sub-Agenten und injiziert die Tool-Schicht.
- **Sub-Agenten**: Der `ReportAgent` (``src/agent/report/ReportAgent.js``) kapselt Bau-Beschrieb-spezifische Fähigkeiten (`bauBeschrieb.upload`, `bauBeschrieb.finalize`). Weitere Sub-Agenten können analog hinterlegt werden.
- **Tool Layer**: Einheitliche Schnittstelle für Datenbank (`DatabaseTool`), Dateiverwaltung (`FileTool`), Mail (`MailTool`) und Report-Erzeugung (`ReportTool`) unter `src/agent/tools/`.
- **Session Handling**: `src/agent/chat/sessionStore.js` hält Konversationskontext bis zur Finalisierung.

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

## Tests & Entwicklung

- **Unit Tests**: `npm test`
- **Prisma Seed**: `npm run prisma:seed`
- Prisma-Middleware-Hook (`instantiateFromTemplate`) wird im Test-Kontext deaktiviert, wenn `$use` nicht verfügbar ist.

## Git-Workflow

- Arbeite auf Feature-Branches (z. B. `feat/agent-architecture`).
- Änderungen vor dem Commit über `git status` prüfen.
- Commit & Push Beispiel:

```powershell
git add .
git status
git commit -m "Beschreibung der Änderung"
git push origin <branch>