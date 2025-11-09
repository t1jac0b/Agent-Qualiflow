import { processBauBeschriebUpload } from "../bauBeschrieb/processBauBeschrieb.js";

export function formatSuccessMessage({ kunde, objekt, objekttyp, pendingFields }) {
  const lines = [
    `✅ Bau-Beschrieb verarbeitet.`,
    `• Kunde: ${kunde.name}`,
    `• Objekt: ${objekt.bezeichnung}`,
    `• Adresse: ${[objekt.adresse, `${objekt.plz} ${objekt.ort}`.trim()].filter(Boolean).join(", ")}`,
  ];

  if (objekttyp?.bezeichnung) {
    lines.push(`• Objekttyp: ${objekttyp.bezeichnung}`);
  }

  const openPrompts = pendingFields
    .filter((item) => item.field === "projektleiter")
    .map((item) => item.message);

  if (openPrompts.length) {
    lines.push("", ...openPrompts.map((msg) => `❓ ${msg}`));
  }

  return lines.join("\n");
}

export function formatMissingMessage({ missingMandatory = [], pendingFields = [] }) {
  const lines = [`⚠️ Bau-Beschrieb benötigt weitere Angaben:`];

  for (const field of missingMandatory) {
    const pending = pendingFields.find((item) => item.field === field);
    if (pending) {
      lines.push(`• ${pending.message}`);
    } else {
      lines.push(`• ${field}`);
    }
  }

  const otherPrompts = pendingFields.filter((item) => !missingMandatory.includes(item.field));
  if (otherPrompts.length) {
    lines.push("", ...otherPrompts.map((item) => `❓ ${item.message}`));
  }

  return lines.join("\n");
}

export async function handleBauBeschriebUpload({ buffer, filePath, originalFilename, uploadedBy }) {
  const result = await processBauBeschriebUpload({ buffer, filePath, originalFilename, uploadedBy });

  if (result.status === "needs_input") {
    return {
      status: "needs_input",
      message: formatMissingMessage(result),
      context: result,
    };
  }

  if (result.status === "created") {
    return {
      status: "created",
      message: formatSuccessMessage(result),
      context: result,
    };
  }

  return {
    status: "unknown",
    message: "Der Bau-Beschrieb konnte nicht verarbeitet werden.",
    context: result,
  };
}
