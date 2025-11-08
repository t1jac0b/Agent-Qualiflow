import { ingestBauBeschrieb } from "./ingestBauBeschrieb.js";
import { DatabaseTool } from "../../tools/DatabaseTool.js";

const MANDATORY_FIELDS = [
  "kunde.name",
  "objekt.adresse",
  "objekt.plz",
  "objekt.ort",
  "objekttyp",
];

function normalizeText(text) {
  return text
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractFromLines(lines, patterns) {
  for (const pattern of patterns) {
    for (const line of lines) {
      const match = pattern.regex.exec(line);
      if (match) {
        const value = match[pattern.group ?? 1];
        if (value) {
          return value.trim();
        }
      }
    }
  }
  return null;
}

function extractMetadata(rawText) {
  const lines = normalizeText(rawText);

  const kundeName = extractFromLines(lines, [
    { regex: /^(?:auftraggeber|kunde|bauherr)\s*[:\-]\s*(.+)$/i },
    { regex: /^kunde\s+(.*)$/i },
  ]);

  const objektBezeichnung = extractFromLines(lines, [
    { regex: /^(?:projekt|objekt|bauvorhaben)\s*[:\-]\s*(.+)$/i },
    { regex: /^projekt\s+(.*)$/i },
  ]);

  const adresse = extractFromLines(lines, [
    { regex: /^(?:adresse|anschrift)\s*[:\-]\s*(.+)$/i },
  ]);

  const plzOrt = extractFromLines(lines, [
    { regex: /(\b\d{4,5}\b)\s+([A-Za-zÄÖÜäöüß\-\s]{3,})/ },
  ]);

  const objekttyp = extractFromLines(lines, [
    { regex: /^(?:objekttyp|nutzung|gebäudetyp)\s*[:\-]\s*(.+)$/i },
  ]);

  let plz = null;
  let ort = null;
  if (plzOrt) {
    const match = /(\b\d{4,5}\b)\s+([A-Za-zÄÖÜäöüß\-\s]{3,})/.exec(plzOrt);
    if (match) {
      plz = match[1];
      ort = match[2].trim();
    }
  }

  const pendingFields = [];

  if (!kundeName) pendingFields.push({ field: "kunde.name", message: "Kunde konnte nicht automatisch erkannt werden." });
  if (!adresse) pendingFields.push({ field: "objekt.adresse", message: "Adresse fehlt im Bau-Beschrieb." });
  if (!plz) pendingFields.push({ field: "objekt.plz", message: "PLZ konnte nicht ermittelt werden." });
  if (!ort) pendingFields.push({ field: "objekt.ort", message: "Ort konnte nicht ermittelt werden." });
  if (!objekttyp) pendingFields.push({ field: "objekttyp", message: "Objekttyp nicht gefunden." });

  pendingFields.push({ field: "projektleiter", message: "Bitte Projektleiter angeben (nicht im Bau-Beschrieb)." });

  return {
    kunde: {
      name: kundeName,
      adresse: adresse,
      plz,
      ort,
    },
    objekt: {
      bezeichnung: objektBezeichnung,
      adresse,
      plz,
      ort,
    },
    objekttyp,
    pendingFields,
  };
}

function collectMissingMandatory({ kunde, objekt, objekttyp }) {
  const missing = [];
  if (!kunde?.name) missing.push("kunde.name");
  if (!objekt?.adresse) missing.push("objekt.adresse");
  if (!objekt?.plz) missing.push("objekt.plz");
  if (!objekt?.ort) missing.push("objekt.ort");
  if (!objekttyp) missing.push("objekttyp");
  return missing;
}

export async function processBauBeschriebUpload({ buffer, filePath, originalFilename, uploadedBy }) {
  const ingestion = await ingestBauBeschrieb({ buffer, filePath, originalFilename, uploadedBy });
  const extracted = extractMetadata(ingestion.extractedText);
  const missingMandatory = collectMissingMandatory(extracted);

  if (missingMandatory.length > 0) {
    return {
      status: "needs_input",
      ingestion,
      extracted,
      missingMandatory,
    };
  }

  const kunde = await DatabaseTool.ensureKunde({
    name: extracted.kunde.name,
    adresse: extracted.kunde.adresse,
    plz: extracted.kunde.plz,
    ort: extracted.kunde.ort,
  });

  const objekttyp = await DatabaseTool.ensureObjekttyp(extracted.objekttyp);

  const objekt = await DatabaseTool.createObjektForKunde({
    kundeId: kunde.id,
    bezeichnung: extracted.objekt.bezeichnung || extracted.kunde.name,
    adresse: extracted.objekt.adresse,
    plz: extracted.objekt.plz,
    ort: extracted.objekt.ort,
    objekttypId: objekttyp?.id,
  });

  return {
    status: "created",
    ingestion,
    extracted,
    kunde,
    objekttyp,
    objekt,
    pendingFields: extracted.pendingFields,
  };
}
