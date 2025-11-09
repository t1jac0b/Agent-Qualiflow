import {
  handleBauBeschriebUpload,
  formatMissingMessage,
  formatSuccessMessage,
  finalizeBauBeschriebAgent,
} from "./handleBauBeschriebUpload.js";
import { getSession, upsertSession, clearSession, pruneSessions } from "./sessionStore.js";

function isPdfAttachment(attachment) {
  if (!attachment) return false;
  const mimetype = attachment.mimetype ?? attachment.contentType;
  const filename = attachment.originalFilename ?? attachment.filename;
  if (mimetype && mimetype.toLowerCase() === "application/pdf") return true;
  if (filename && filename.toLowerCase().endsWith(".pdf")) return true;
  return false;
}

function cleanValue(value) {
  if (!value) return value;
  return value.replace(/["“”]+/g, "").trim();
}

function assignOverride(overrides, field, rawValue) {
  const value = cleanValue(rawValue);
  if (!value) return;

  if (field === "projektleiter") {
    overrides.projektleiter = value;
    return;
  }

  if (field === "projektleiterEmail") {
    overrides.projektleiterEmail = value;
    return;
  }

  if (field === "projektleiterTelefon") {
    overrides.projektleiterTelefon = value;
    return;
  }

  const [scope, key] = field.split(".");
  if (!scope || !key) return;
  overrides[scope] ||= {};
  overrides[scope][key] = value;
}

function mergeOverrides(base = {}, update = {}) {
  const merged = { ...base };
  if (update.kunde) {
    merged.kunde = { ...(merged.kunde ?? {}), ...update.kunde };
  }
  if (update.objekt) {
    merged.objekt = { ...(merged.objekt ?? {}), ...update.objekt };
  }
  if (update.objekttyp !== undefined) {
    merged.objekttyp = update.objekttyp;
  }
  if (update.projektleiter !== undefined) {
    merged.projektleiter = update.projektleiter;
  }
  if (update.projektleiterEmail !== undefined) {
    merged.projektleiterEmail = update.projektleiterEmail;
  }
  if (update.projektleiterTelefon !== undefined) {
    merged.projektleiterTelefon = update.projektleiterTelefon;
  }
  return merged;
}

function hasOverrides(update = {}) {
  if (update.projektleiter) return true;
  if (update.projektleiterEmail) return true;
  if (update.projektleiterTelefon) return true;
  if (update.objekttyp) return true;
  if (update.kunde && Object.keys(update.kunde).length > 0) return true;
  if (update.objekt && Object.keys(update.objekt).length > 0) return true;
  return false;
}

function chooseField(pendingSet, fieldCandidates, fallback) {
  for (const field of fieldCandidates) {
    if (pendingSet.has(field)) return field;
  }
  return fallback;
}

function parseOverridesFromMessage(message = "", pendingFields = []) {
  const overrides = {};
  const pendingSet = new Set(pendingFields.map((item) => item.field));
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const normalized = lines.length ? lines : [message.trim()].filter(Boolean);

  for (const rawLine of normalized) {
    const line = rawLine.replace(/\s+/g, " ").trim();

    const projektleiterMatch = line.match(/projektleiter\s*[:\-]\s*([^]+)/i);
    if (projektleiterMatch) {
      assignOverride(overrides, "projektleiter", projektleiterMatch[1]);
      continue;
    }

    const projektleiterEmailMatch = line.match(/projektleiter\s*(?:e-?mail|email)\s*[:\-]\s*([^]+)/i);
    if (projektleiterEmailMatch) {
      assignOverride(overrides, "projektleiterEmail", projektleiterEmailMatch[1]);
      continue;
    }

    const projektleiterTelefonMatch = line.match(/projektleiter\s*(?:telefon|tel)\s*[:\-]\s*([^]+)/i);
    if (projektleiterTelefonMatch) {
      assignOverride(overrides, "projektleiterTelefon", projektleiterTelefonMatch[1]);
      continue;
    }

    const kundeMatch = line.match(/kunde(?:\s+name)?\s*[:\-]\s*([^]+)/i);
    if (kundeMatch) {
      assignOverride(overrides, "kunde.name", kundeMatch[1]);
      continue;
    }

    const adresseMatch = line.match(/adresse\s*[:\-]\s*([^]+)/i);
    if (adresseMatch) {
      const target = chooseField(pendingSet, ["objekt.adresse", "kunde.adresse"], "objekt.adresse");
      assignOverride(overrides, target, adresseMatch[1]);
      continue;
    }

    const plzMatch = line.match(/plz\s*[:\-]?\s*(\d{4,5})/i);
    if (plzMatch) {
      const target = chooseField(pendingSet, ["objekt.plz", "kunde.plz"], "objekt.plz");
      assignOverride(overrides, target, plzMatch[1]);
      const ortInline = line.match(/ort\s*[:\-]\s*([^]+)/i);
      if (ortInline) {
        const ortTarget = chooseField(pendingSet, ["objekt.ort", "kunde.ort"], "objekt.ort");
        assignOverride(overrides, ortTarget, ortInline[1]);
      }
      continue;
    }

    const ortMatch = line.match(/ort\s*[:\-]\s*([^]+)/i);
    if (ortMatch) {
      const target = chooseField(pendingSet, ["objekt.ort", "kunde.ort"], "objekt.ort");
      assignOverride(overrides, target, ortMatch[1]);
      continue;
    }

    const plzOrtMatch = line.match(/(\d{4,5})\s+([A-Za-zÄÖÜäöüß\-\s]+)/);
    if (plzOrtMatch) {
      const [_, plz, ort] = plzOrtMatch;
      const plzField = chooseField(pendingSet, ["objekt.plz", "kunde.plz"], "objekt.plz");
      const ortField = chooseField(pendingSet, ["objekt.ort", "kunde.ort"], "objekt.ort");
      assignOverride(overrides, plzField, plz);
      assignOverride(overrides, ortField, ort);
      continue;
    }
  }

  if (!hasOverrides(overrides)) {
    return {};
  }

  if (overrides.kunde && Object.keys(overrides.kunde).length === 0) {
    delete overrides.kunde;
  }
  if (overrides.objekt && Object.keys(overrides.objekt).length === 0) {
    delete overrides.objekt;
  }

  return overrides;
}

export async function handleChatMessage({ chatId, message = "", attachments = [], uploadedBy } = {}) {
  pruneSessions({ maxAgeMinutes: 120 });

  const pdfAttachment = attachments.find(isPdfAttachment);
  if (pdfAttachment) {
    const result = await handleBauBeschriebUpload({
      buffer: pdfAttachment.buffer,
      filePath: pdfAttachment.filePath,
      originalFilename: pdfAttachment.originalFilename ?? pdfAttachment.filename,
      uploadedBy,
    });

    if (result.status === "needs_input") {
      upsertSession(chatId, {
        mode: "bau-beschrieb",
        ingestion: result.context.ingestion,
        baseExtracted: result.context.extracted,
        overrides: {},
        pendingFields: result.context.pendingFields ?? [],
        missingMandatory: result.context.missingMandatory ?? [],
      });
    } else if (result.status === "created") {
      clearSession(chatId);
    }

    return result;
  }

  const session = getSession(chatId);
  if (!session || session.mode !== "bau-beschrieb") {
    return {
      status: "idle",
      message: "Bitte lade zuerst einen Bau-Beschrieb (PDF) hoch, damit ich helfen kann.",
      context: null,
    };
  }

  const overrides = parseOverridesFromMessage(message, session.pendingFields);

  if (!hasOverrides(overrides)) {
    return {
      status: "needs_input",
      message: [
        "Ich konnte keine neuen Angaben erkennen.",
        formatMissingMessage({
          missingMandatory: session.missingMandatory,
          pendingFields: session.pendingFields,
        }),
      ].join("\n\n"),
      context: {
        ingestion: session.ingestion,
        extracted: session.baseExtracted,
        missingMandatory: session.missingMandatory,
        pendingFields: session.pendingFields,
      },
    };
  }

  const mergedOverrides = mergeOverrides(session.overrides, overrides);

  const result = await finalizeBauBeschriebAgent({
    ingestion: session.ingestion,
    extracted: session.baseExtracted,
    overrides: mergedOverrides,
  });

  if (result.status === "needs_input") {
    upsertSession(chatId, {
      mode: "bau-beschrieb",
      ingestion: session.ingestion,
      baseExtracted: session.baseExtracted,
      overrides: mergedOverrides,
      pendingFields: result.pendingFields,
      missingMandatory: result.missingMandatory,
    });

    return {
      status: "needs_input",
      message: formatMissingMessage(result),
      context: result,
    };
  }

  clearSession(chatId);

  return {
    status: "created",
    message: formatSuccessMessage(result),
    context: result,
  };
}

export const __test__ = {
  parseOverridesFromMessage,
  mergeOverrides,
};
