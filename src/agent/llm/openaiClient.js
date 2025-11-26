import OpenAI from "openai";

let client = null;

export function getOpenAI() {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY ist nicht gesetzt. Bitte in der .env konfigurieren.");
  }
  client = new OpenAI({ apiKey });
  return client;
}

export function getOpenAIModel() {
  return process.env.OPENAI_MODEL || "gpt-4o";
}

export async function generateExecutiveSummary({ client: passedClient, model, report, maxTokens = 400 }) {
  if (!report) {
    throw new Error("generateExecutiveSummary: 'report' ist erforderlich.");
  }

  const clientToUse = passedClient ?? getOpenAI();
  const modelToUse = model ?? getOpenAIModel();

  const objekt = report.objekt?.bezeichnung ?? "-";
  const kunde = report.kunde?.name ?? "-";
  const datum =
    report.baurundgang?.datumDurchgefuehrt || report.baurundgang?.datumGeplant || "-";

  const positions = (report.positionen ?? []).map((p) => ({
    pos: p.positionsnummer,
    bereich:
      p.bauteil?.template?.name ||
      p.bauteil?.materialisierung?.name ||
      p.bereichstitel ||
      p.bereich?.name ||
      "-",
    bemerkung: p.bemerkung || "-",
    rueckmeldung: p.rueckmeldungstyp?.name || null,
  }));

  const system =
    "Du bist ein Bau-QS-Assistent. Formuliere eine kurze Executive Summary (2-3 Sätze) "+
    "über den Zustand und die wichtigsten Punkte des Baurundgangs. Keine Listen, sondern Fließtext.";
  const user = {
    role: "user",
    content: [
      { type: "text", text: `Projekt: ${objekt} | Kunde: ${kunde} | Datum: ${String(datum)}` },
      { type: "text", text: `Positionen (kompakt): ${JSON.stringify(positions).slice(0, 6000)}` },
    ],
  };

  const response = await clientToUse.chat.completions.create({
    model: modelToUse,
    messages: [{ role: "system", content: system }, user],
    temperature: 0.3,
    max_tokens: maxTokens,
  });

  return response.choices?.[0]?.message?.content?.trim() || "";
}
