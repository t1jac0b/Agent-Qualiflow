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
