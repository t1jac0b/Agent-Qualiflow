import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";

const EXCEL_PATH = path.join(process.cwd(), "storage", "pruefpunkte", "_MasterCheckliste.xlsx");

// Mapping BR-Nummer -> Sheet-Key (Teil des Reiternamens)
// Beispiel: BR 1 -> Reitername enthält "MS 2.2" usw.
const SHEET_KEY_BY_BR_NUMMER = {
  1: "MS 2.2",
  2: "MS 2.3",
  3: "MS 2.4",
  4: "MS 2.5",
  5: "MS 2.6",
  6: "MS 2.7",
};

let workbookCache = null;

async function loadWorkbook() {
  if (workbookCache) return workbookCache;

  const buffer = await fs.readFile(EXCEL_PATH);
  const wb = XLSX.read(buffer, { type: "buffer" });
  workbookCache = wb;
  return wb;
}

function normalizeCell(value) {
  if (value == null) return "";
  const text = String(value).trim();
  return text;
}

function parseSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  const items = [];
  let currentBereich = null;

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const col0 = normalizeCell(row[0]);
    const col1 = normalizeCell(row[1]);

    if (!col0 && !col1) {
      continue;
    }

    // Heuristik: Zeile mit nur Spalte 1 = Bereichsüberschrift
    if (col0 && !col1) {
      currentBereich = col0;
      continue;
    }

    if (col0) {
      items.push({
        bereich: currentBereich,
        text: col0,
        quelle: col1 || null,
      });
    }
  }

  return items;
}

export async function loadMasterChecklisteForBaurundgang(baurundgangTypNummer) {
  if (!baurundgangTypNummer && baurundgangTypNummer !== 0) {
    return null;
  }

  const wb = await loadWorkbook();
  const key = SHEET_KEY_BY_BR_NUMMER[Number(baurundgangTypNummer)];
  if (!key) {
    return null;
  }

  const sheetName = wb.SheetNames.find((name) =>
    typeof name === "string" && name.toLowerCase().includes(String(key).toLowerCase()),
  );
  if (!sheetName) {
    return null;
  }

  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    return null;
  }

  const items = parseSheet(sheet);
  return {
    sheetName,
    typNummer: Number(baurundgangTypNummer),
    items,
  };
}
