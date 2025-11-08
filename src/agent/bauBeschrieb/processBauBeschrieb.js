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

function parseAddressFromLine(line, { stripLeadingIndex = false } = {}) {
  if (!line) return {};
  let raw = line.replace(/\s+/g, " ").trim();
  if (!raw) return {};

  if (stripLeadingIndex) {
    raw = raw.replace(/^\d+\s+/, "");
  }

  const fullMatch = raw.match(/^(.*?)(?:,\s*|\s+)(\d{4,5})\s+([A-Za-zÄÖÜäöüß\-\s]+)$/);
  if (fullMatch) {
    return {
      adresse: fullMatch[1].trim() || null,
      plz: fullMatch[2],
      ort: fullMatch[3].trim() || null,
    };
  }

  const plzOnly = raw.match(/^(\d{4,5})\s+([A-Za-zÄÖÜäöüß\-\s]+)$/);
  if (plzOnly) {
    return {
      plz: plzOnly[1],
      ort: plzOnly[2].trim() || null,
    };
  }

  const addressWithPlzOnly = raw.match(/^(.*?)(?:,\s*|\s+)(\d{4,5})$/);
  if (addressWithPlzOnly) {
    return {
      adresse: addressWithPlzOnly[1].trim() || null,
      plz: addressWithPlzOnly[2],
    };
  }

  return { adresse: raw || null };
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

function getBlockAfterLabel(lines, labelRegex, { maxLines = 4 } = {}) {
  const index = lines.findIndex((line) => labelRegex.test(line));
  if (index === -1) return [];

  const block = [];
  for (let i = index + 1; i < lines.length && block.length < maxLines; i++) {
    const current = lines[i];
    if (!current) continue;
    if (current.includes(":")) {
      if (block.length === 0) continue;
      break;
    }
    block.push(current);
    if (block.length >= maxLines) break;
  }
  return block;
}

function extractMetadata(rawText) {
  const lines = normalizeText(rawText);

  const kundeName = extractFromLines(lines, [
    { regex: /^(?:auftraggeber|kunde|bauherr|bauherrschaft)\s*[:\-]\s*(.+)$/i },
    { regex: /^kunde\s+(.*)$/i },
  ]);

  let objektBezeichnung = extractFromLines(lines, [
    { regex: /^(?:projekt|objekt|bauvorhaben)\s*[:\-]\s*(.+)$/i },
    { regex: /^projekt\s+(.*)$/i },
  ]);

  const adresse = extractFromLines(lines, [
    { regex: /^(?:adresse|anschrift)\s*[:\-]\s*(.+)$/i },
  ]);

  const objektPlzLine = extractFromLines(lines, [
    { regex: /^plz\s*[:\-]\s*(\d{4,5})/i },
    { regex: /\bplz\s*[:\-]\s*(\d{4,5})/i },
  ]);

  const objektOrtLine = extractFromLines(lines, [
    { regex: /^ort\s*[:\-]\s*(.+)$/i },
  ]);

  const plzOrt = extractFromLines(lines, [
    { regex: /(\b\d{4,5}\b)\s+([A-Za-zÄÖÜäöüß\-\s]{3,})/ },
  ]);

  const objekttyp = extractFromLines(lines, [
    { regex: /^(?:objekttyp|nutzung|gebäudetyp)\s*[:\-]\s*(.+)$/i },
  ]);

  const headerLine = lines.find((line) => /\b(umbau|neubau|sanierung|projekt)\b/i.test(line));

  let objektPlz = null;
  let objektOrt = null;
  if (plzOrt) {
    const match = /(\b\d{4,5}\b)\s+([A-Za-zÄÖÜäöüß\-\s]{3,})/.exec(plzOrt);
    if (match) {
      objektPlz = match[1];
      objektOrt = match[2].trim();
    }
  }

  const pendingFields = [];

  let kundeAdresse = null;
  let kundePlz = null;
  let kundeOrt = null;

  if (!kundeName) {
    const block = getBlockAfterLabel(lines, /^bauherrschaft:?$/i, { maxLines: 4 });
    if (block.length) {
      kundeName = block[0] ?? kundeName;
      const addrParsed = parseAddressFromLine(block[1] ?? "");
      if (!kundeAdresse && addrParsed.adresse) {
        kundeAdresse = addrParsed.adresse;
      }
      if (!kundePlz && addrParsed.plz) {
        kundePlz = addrParsed.plz;
      }
      if (!kundeOrt && addrParsed.ort) {
        kundeOrt = addrParsed.ort;
      }

      const cityParsed = parseAddressFromLine(block[2] ?? "");
      if (!kundePlz && cityParsed.plz) {
        kundePlz = cityParsed.plz;
      }
      if (!kundeOrt && cityParsed.ort) {
        kundeOrt = cityParsed.ort;
      }
    }
  }

  let objektAdresse = adresse;
  const headerIndex = headerLine ? lines.indexOf(headerLine) : -1;
  if (headerLine) {
    const parsedHeader = parseAddressFromLine(headerLine, { stripLeadingIndex: true });
    if (!objektBezeichnung) {
      objektBezeichnung = parsedHeader.adresse || headerLine.replace(/^\d+\s+/, "").trim();
    }
    if (!objektAdresse && parsedHeader.adresse) {
      objektAdresse = parsedHeader.adresse;
    }
    if (!objektPlz && parsedHeader.plz) objektPlz = parsedHeader.plz;
    if (!objektOrt && parsedHeader.ort) objektOrt = parsedHeader.ort;

    const nextLine = headerIndex >= 0 ? lines[headerIndex + 1] : null;
    if (nextLine) {
      const parsedNext = parseAddressFromLine(nextLine);
      if (!objektPlz && parsedNext.plz) objektPlz = parsedNext.plz;
      if (!objektOrt && parsedNext.ort) objektOrt = parsedNext.ort;
      if (!objektOrt && !parsedNext.plz && parsedNext.adresse) {
        objektOrt = parsedNext.adresse;
      }
    }
  }

  if (!objektAdresse && adresse) {
    objektAdresse = adresse;
  }

  if (objektAdresse) {
    const cleanedAdresse = objektAdresse
      .replace(/\bPLZ\s*[:\-]?\s*\d{4,5}\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/[,:;]\s*$/, "")
      .trim();
    if (cleanedAdresse) {
      objektAdresse = cleanedAdresse;
    }
  }

  if (!objektPlz && objektPlzLine) {
    const plzMatch = /(\d{4,5})/.exec(objektPlzLine);
    if (plzMatch) {
      objektPlz = plzMatch[1];
    }
  }

  if (!objektOrt && objektOrtLine) {
    const cleanedOrt = objektOrtLine.replace(/^ort\s*[:\-]\s*/i, "").replace(/["“”]/g, "").trim();
    if (cleanedOrt) {
      objektOrt = cleanedOrt;
    }
  }

  const wohneinheiten = extractFromLines(lines, [
    { regex: /anzahl\s+wohneinheiten\s*[:\-]\s*(\d+)/i },
  ]);

  const gewerberaeume = extractFromLines(lines, [
    { regex: /anzahl\s+gewerberäume?\s*[:\-]\s*(\d+)/i },
  ]);

  const erstellungsjahrRaw = extractFromLines(lines, [
    { regex: /erstellungsjahr\s*[:\-]\s*(\d{4})/i },
  ]);

  const erstellungsjahr = erstellungsjahrRaw ? Number.parseInt(erstellungsjahrRaw, 10) : null;

  const objektNotizParts = [];
  if (wohneinheiten) objektNotizParts.push(`Wohneinheiten: ${wohneinheiten}`);
  if (gewerberaeume) objektNotizParts.push(`Gewerberäume: ${gewerberaeume}`);
  const objektNotiz = objektNotizParts.length ? objektNotizParts.join("\n") : undefined;

  if (!kundeName) pendingFields.push({ field: "kunde.name", message: "Kunde konnte nicht automatisch erkannt werden." });
  if (!objektAdresse) pendingFields.push({ field: "objekt.adresse", message: "Adresse fehlt im Bau-Beschrieb." });
  if (!objektPlz) pendingFields.push({ field: "objekt.plz", message: "PLZ konnte nicht ermittelt werden." });
  if (!objektOrt) pendingFields.push({ field: "objekt.ort", message: "Ort konnte nicht ermittelt werden." });
  if (!objekttyp) pendingFields.push({ field: "objekttyp", message: "Objekttyp nicht gefunden." });

  pendingFields.push({ field: "projektleiter", message: "Bitte Projektleiter angeben (nicht im Bau-Beschrieb)." });

  return {
    kunde: {
      name: kundeName,
      adresse: kundeAdresse,
      plz: kundePlz,
      ort: kundeOrt,
    },
    objekt: {
      bezeichnung: objektBezeichnung,
      adresse: objektAdresse,
      plz: objektPlz,
      ort: objektOrt,
      notiz: objektNotiz,
      erstellungsjahr,
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
    notiz: extracted.objekt.notiz,
    erstellungsjahr: extracted.objekt.erstellungsjahr,
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
