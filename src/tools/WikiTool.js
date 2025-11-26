import { promises as fs } from "node:fs";
import path from "node:path";
import pdfParse from "pdf-parse";

const WIKI_ROOT = path.join(process.cwd(), "storage", "wiki");

async function ensureWikiRoot() {
  await fs.mkdir(WIKI_ROOT, { recursive: true });
}

async function listDocumentsInternal({ extensions } = {}) {
  await ensureWikiRoot();
  const allowed = (extensions?.length ? extensions : [".pdf", ".md", ".markdown", ".txt"]).map((ext) =>
    ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`,
  );

  const results = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (!allowed.includes(ext)) continue;
        results.push({
          path: fullPath,
          relativePath: path.relative(WIKI_ROOT, fullPath),
          extension: ext,
        });
      }
    }
  }

  await walk(WIKI_ROOT);
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function readDocumentInternal({ relativePath }) {
  if (!relativePath) {
    throw new Error("WikiTool.readDocument: 'relativePath' ist erforderlich.");
  }

  await ensureWikiRoot();
  const absPath = path.join(WIKI_ROOT, relativePath);
  const ext = path.extname(absPath).toLowerCase();

  if (ext === ".pdf") {
    const buf = await fs.readFile(absPath);
    const parsed = await pdfParse(buf);
    return {
      relativePath,
      extension: ext,
      text: parsed.text ?? "",
      info: parsed.info ?? null,
      metadata: parsed.metadata ?? null,
      numPages: parsed.numpages ?? parsed.numrender ?? null,
    };
  }

  const text = await fs.readFile(absPath, "utf8");
  return {
    relativePath,
    extension: ext,
    text,
  };
}

function buildSnippet(text, query) {
  const normalized = String(text ?? "");
  const lower = normalized.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) {
    return normalized.slice(0, 240);
  }
  const start = Math.max(0, idx - 80);
  const end = Math.min(normalized.length, idx + q.length + 160);
  return `${start > 0 ? "" : ""}${normalized.slice(start, end).trim()}${end < normalized.length ? "" : ""}`;
}

export const WikiTool = {
  root: WIKI_ROOT,

  async listDocuments(options = {}) {
    return listDocumentsInternal(options);
  },

  async readDocument(payload) {
    return readDocumentInternal(payload ?? {});
  },

  async search({ query, limit = 10 } = {}) {
    if (!query || !String(query).trim()) {
      throw new Error("WikiTool.search: 'query' ist erforderlich.");
    }

    const docs = await listDocumentsInternal({});
    if (!docs.length) {
      return [];
    }

    const lcQuery = query.toLowerCase();
    const results = [];

    for (const doc of docs) {
      let docText = "";
      try {
        const content = await readDocumentInternal({ relativePath: doc.relativePath });
        docText = content.text ?? "";
      } catch {
        // Unlesbare Dokumente überspringen
        continue;
      }

      const lower = docText.toLowerCase();
      const idx = lower.indexOf(lcQuery);
      if (idx === -1) continue;

      let score = 0;
      let pos = idx;
      while (pos !== -1) {
        score += 1;
        pos = lower.indexOf(lcQuery, pos + lcQuery.length);
      }

      results.push({
        relativePath: doc.relativePath,
        extension: doc.extension,
        score,
        snippet: buildSnippet(docText, query),
      });
    }

    results.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));
    return results.slice(0, limit);
  },
};
