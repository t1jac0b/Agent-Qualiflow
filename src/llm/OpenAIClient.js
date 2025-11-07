// In: src/llm/OpenAIClient.js
import OpenAI from 'openai';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export function makeOpenAIClient({ apiKey = process.env.OPENAI_API_KEY, baseURL = process.env.OPENAI_BASE_URL } = {}) {
  requireEnv('OPENAI_API_KEY');
  const client = new OpenAI({ apiKey, baseURL });
  return client;
}

export async function generateExecutiveSummary({ client, model = process.env.OPENAI_MODEL || 'gpt-4o', report, maxTokens = 400 }) {
  const objekt = report.objekt?.bezeichnung ?? '-';
  const kunde = report.kunde?.name ?? '-';
  const datum = report.baurundgang?.datumDurchgefuehrt || report.baurundgang?.datumGeplant || '-';

  const positions = (report.positionen ?? []).map(p => ({
    pos: p.positionsnummer,
    bereich: p.bauteil?.template?.name || p.bauteil?.materialisierung?.name || p.bereichstitel || p.bereich?.name || '-',
    bemerkung: p.bemerkung || '-',
    rueckmeldung: p.rueckmeldungstyp?.name || null,
  }));

  const system = `Du bist ein Bau-QS-Assistent. Formuliere eine kurze Executive Summary (2-3 Sätze) über den Zustand und die wichtigsten Punkte des Baurundgangs. Keine Listen, sondern Fließtext.`;
  const user = {
    role: 'user',
    content: [
      { type: 'text', text: `Projekt: ${objekt} | Kunde: ${kunde} | Datum: ${String(datum)}` },
      { type: 'text', text: `Positionen (kompakt): ${JSON.stringify(positions).slice(0, 6000)}` },
    ]
  };

  const resp = await client.chat.completions.create({
    model,
    messages: [ { role: 'system', content: system }, user ],
    temperature: 0.3,
    max_tokens: maxTokens,
  });

  return resp.choices?.[0]?.message?.content?.trim() || '';
}
