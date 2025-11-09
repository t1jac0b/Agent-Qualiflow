#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs/promises';

const prisma = new PrismaClient();

function usage() {
  console.error('Usage: node scripts/importQsKatalog.js --input <path-to-txt>');
}

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return null;
}

const inputPath = getArg('--input') || getArg('-i');
if (!inputPath) {
  usage();
  process.exit(1);
}

function normalize(str) {
  return str.replace(/\r\n?/g, '\n').replace(/[\u00A0\u202F]/g, ' ').trim();
}

function startsNewPos(line) {
  return /^\s*\d+\./.test(line);
}

function parseBkp(line) {
  const m = /^\s*BKP\s+(\d{3}(?:\.\d+)?)\b(?:\s*(.*))?$/i.exec(line);
  if (!m) return null;
  const code = m[1];
  const label = (m[2] || '').trim();
  return { code, major: parseInt(code.split('.')[0], 10), label };
}

function splitKapitelAndText(line) {
  if (!line) return { kapitel: '', text: '' };
  if (line.includes('\t')) {
    const [lhs, ...rhs] = line.split(/\t+/);
    return { kapitel: (lhs || '').trim(), text: rhs.join('\t').trim() };
  }
  const m = /^(\S.{0,80}?)(?:\s{2,})(.+)$/.exec(line);
  if (m) return { kapitel: (m[1] || '').trim(), text: (m[2] || '').trim() };
  return { kapitel: line.trim(), text: '' };
}

function hasAny(s, kws) {
  const L = s.toLowerCase();
  return kws.some(k => L.includes(k));
}

function mapToBauteil(entry) {
  const { bkp, bereichName, kapitelName } = entry;
  const t = `${bereichName || ''} ${kapitelName || ''} ${entry.text.join('\n')}`.toLowerCase();
  const major = bkp?.major;

  if (!bkp && bereichName && bereichName.toLowerCase().includes('vorbedingungen')) return 'Rohbau';

  if (major === 224) {
    if (hasAny(t, ['flachdach', 'warmdach', 'kaltdach', 'bitumen', 'kautschuk', 'dachwassereinlauf', 'notüberlauf', 'notueberlauf'])) return 'Flachdach';
    if (hasAny(t, ['steildach', 'ziegel', 'satteldach', 'giebeldach', 'walmdach', 'mansarddach'])) return 'Steildach';
    return 'Flachdach';
  }

  if (major === 221) {
    if (hasAny(t, ['tür', 'tuere', 'tore', 'tor', 'aussentüre', 'innentür', 'rolltor', 'sektionaltor', 'schiebetür', 'drehtür', 'falttor'])) return 'Türen/Tore';
    return 'Fenster';
  }

  if (major === 272 || major === 273) {
    if (hasAny(t, ['tür', 'tuere', 'tor', 'aussentüre', 'innentür', 'garagentor', 'rolltor', 'sektionaltor'])) return 'Türen/Tore';
    return 'Übriger Innenausbau';
  }

  if (major === 525) {
    if (hasAny(t, ['wartung', 'inbetrieb', 'betrieb', 'unterlagen', 'dokumentation'])) return 'Übrige Gebäudetechnik';
    return 'Übrige Gebäudetechnik';
  }

  if ([101,113,132,152,175,201,211,212,391,392].includes(major)) return 'Rohbau';
  if (major === 215 || major === 226) return 'Fassaden';
  if (major === 228) return 'Läden/Sonnenschutz';
  if (major === 223 || major === 230 || major === 232) return 'Elektro';
  if (major === 242) return 'Wärmeerzeugung';
  if (major === 243) return 'Wärmeverteilung';
  if (major === 244) return 'Lüftungsanlagen';
  if (major === 250 || major === 254) return 'Sanitär';
  if (major === 258) return 'Innenausbau Küche';
  if (major === 261) return 'Lifte/Hebebühnen';
  if ([271,279,281,285,287,289].includes(major)) return 'Übriger Innenausbau';
  if (major === 298) return 'Übrige Gebäudetechnik';
  if (major === 421) return 'Tiefbau/Umgebung';

  if (hasAny(t, ['flachdach'])) return 'Flachdach';
  if (hasAny(t, ['steildach', 'ziegel'])) return 'Steildach';
  if (hasAny(t, ['fenster', 'verglasung', 'sigab'])) return 'Fenster';
  if (hasAny(t, ['tür', 'tuere', 'tor'])) return 'Türen/Tore';
  if (hasAny(t, ['fassade', 'putz'])) return 'Fassaden';
  if (hasAny(t, ['elektr', 'strom', 'beleuchtung'])) return 'Elektro';
  if (hasAny(t, ['wärmepumpe', 'heizung'])) return 'Wärmeerzeugung';
  if (hasAny(t, ['bodenheizung', 'heizkörper', 'tabs'])) return 'Wärmeverteilung';
  if (hasAny(t, ['lüftung', 'kälte', 'klima'])) return 'Lüftungsanlagen';
  if (hasAny(t, ['sanitär', 'trinkwasser', 'abwass', 'dusche', 'wc'])) return 'Sanitär';
  if (hasAny(t, ['küche', 'dunstabzug'])) return 'Innenausbau Küche';
  if (hasAny(t, ['gärtner', 'umgebung', 'tiefgarage rampe'])) return 'Tiefbau/Umgebung';
  return 'Übriger Innenausbau';
}

function parseEntries(text) {
  const lines = normalize(text).split('\n');
  const entries = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    if (startsNewPos(line)) {
      if (cur) entries.push(cur);
      cur = { posLine: line, bereichName: null, bkp: null, kapitelName: null, text: [] };
      continue;
    }
    if (!cur) continue;
    const bkp = parseBkp(line);
    if (bkp && !cur.bkp) { cur.bkp = bkp; continue; }
    if (!cur.bereichName) { cur.bereichName = line; continue; }
    if (!cur.kapitelName) {
      const { kapitel, text } = splitKapitelAndText(raw);
      cur.kapitelName = kapitel || null;
      if (text) cur.text.push(text);
      continue;
    }
    cur.text.push(raw);
  }
  if (cur) entries.push(cur);
  return entries;
}

async function upsertBereichTree(bauteilName, bereichName, kapitelName, text, ord) {
  const bt = await prisma.bauteilTemplate.findFirst({ where: { name: bauteilName } });
  if (!bt) throw new Error(`BauteilTemplate not found: ${bauteilName}`);
  const bereich = await prisma.bereichTemplate.findFirst({ where: { name: bereichName, bauteilTemplateId: bt.id } })
    || await prisma.bereichTemplate.create({ data: { name: bereichName, reihenfolge: ord, aktiv: true, bauteilTemplate: { connect: { id: bt.id } } } });
  const kapitel = await prisma.bereichKapitelTemplate.findFirst({ where: { name: kapitelName, bereichTemplateId: bereich.id } })
    || await prisma.bereichKapitelTemplate.create({ data: { name: kapitelName, reihenfolge: ord, bereichTemplate: { connect: { id: bereich.id } } } });
  const existingText = await prisma.bereichKapitelTextTemplate.findFirst({ where: { text, bereichKapitelTemplateId: kapitel.id } });
  if (existingText) {
    await prisma.bereichKapitelTextTemplate.update({ where: { id: existingText.id }, data: { reihenfolge: ord } });
  } else {
    await prisma.bereichKapitelTextTemplate.create({ data: { text, reihenfolge: ord, kapitelTemplate: { connect: { id: kapitel.id } } } });
  }
}

async function main() {
  const raw = await fs.readFile(inputPath, 'utf8');
  const entries = parseEntries(raw);
  let imported = 0;
  for (let idx = 0; idx < entries.length; idx++) {
    const e = entries[idx];
    const text = e.text.join('\n').trim();
    if (!e.kapitelName || !text) continue;
    let bereichName = e.bereichName || (e.bkp ? `BKP ${e.bkp.code}` : 'Allgemein');
    const bauteil = mapToBauteil({ bkp: e.bkp, bereichName, kapitelName: e.kapitelName, text: e.text });
    await upsertBereichTree(bauteil, bereichName, e.kapitelName, text, idx + 1);
    imported++;
  }
  console.log(`Imported/updated ${imported} entries.`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
