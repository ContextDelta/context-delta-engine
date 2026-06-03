import { readFileSnippet } from "./scanner.js";

// A local, deterministic relevance index: no embeddings, no model calls. It
// reads candidate file content once per packet build and derives two signals
// the path-only ranker was blind to:
//
//   1. content terms   — what the file actually talks about, IDF-weighted so
//      rare, discriminating words (e.g. "rotation", "charge") count for more
//      than common ones that appear everywhere.
//   2. declared symbols — function / class / type / def names the file
//      defines, matched against the task with extra weight, since a task
//      keyword landing on a declared name is a much stronger signal than a
//      passing mention.
//
// This is what generalizes the ranker beyond a hardcoded domain regex: "auth"
// or "payments" relevance now emerges from the content and symbols of the repo
// itself, in any language, rather than a baked-in keyword list.

const TERM_SPLIT = /[^a-z0-9_]+/;
const MIN_TERM_LENGTH = 3;

const STOPWORDS = new Set([
  "about", "after", "again", "also", "and", "are", "but", "can", "change",
  "code", "for", "from", "how", "into", "make", "need", "not", "the", "that",
  "this", "use", "what", "when", "with", "your", "const", "let", "var",
  "function", "return", "import", "export", "from", "class", "def", "func",
  "type", "true", "false", "null", "void", "new"
]);

// Pragmatic, language-aware declaration patterns. Not a full parser: a
// lightweight symbol extractor covering JS/TS, Python, and Go declarations —
// the same languages the source graph resolves — approximating a tree-sitter
// symbol index without a native dependency.
const SYMBOL_PATTERNS = [
  /(?:^|\s)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /(?:^|\s)(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /(?:^|\s)(?:export\s+)?(?:interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  /(?:^|\s)(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/g,
  /(?:^|\s)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /(?:^|\s)def\s+([A-Za-z_][\w]*)/g,
  /(?:^|\s)func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/g,
  /(?:^|\s)(?:pub\s+)?fn\s+([A-Za-z_]\w*)/g,
  /(?:^|\s)(?:pub\s+)?(?:struct|trait|enum)\s+([A-Za-z_]\w*)/g,
  /(?:^|\s)module\s+([A-Za-z_]\w*)/g
];

// Splits an identifier into its parts so a task keyword can match part of a
// compound name: validateOrder -> {validateorder, validate, order};
// charge_amount -> {chargeamount, charge, amount}.
export function tokenizeIdentifier(name) {
  const lower = String(name).toLowerCase();
  const parts = String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .toLowerCase()
    .split(/\s+/);
  return [lower, ...parts].filter((part) => part.length >= MIN_TERM_LENGTH && !STOPWORDS.has(part));
}

function contentTermCounts(lowerContent) {
  const counts = new Map();
  for (const raw of lowerContent.split(TERM_SPLIT)) {
    if (raw.length < MIN_TERM_LENGTH || STOPWORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return counts;
}

function extractSymbolTerms(content) {
  const terms = new Set();
  for (const pattern of SYMBOL_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      if (!match[1]) continue;
      for (const term of tokenizeIdentifier(match[1])) terms.add(term);
    }
  }
  return terms;
}

export async function buildRelevanceIndex(files, options = {}) {
  const maxChars = options.maxChars ?? 12_000;
  const candidates = files.filter((file) => file.textLike && !file.tooLarge);
  const byPath = new Map();
  const documentFrequency = new Map();

  for (const file of candidates) {
    let content = "";
    try {
      content = await readFileSnippet(file, { maxChars });
    } catch {
      content = "";
    }
    const termCounts = contentTermCounts(content.toLowerCase());
    const symbolTerms = extractSymbolTerms(content);
    byPath.set(file.path, { symbolTerms, termCounts });

    // A term counts once per document for IDF, whether it shows up in content
    // or as a symbol.
    const seen = new Set([...termCounts.keys(), ...symbolTerms]);
    for (const term of seen) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const total = candidates.length || 1;
  return {
    byPath,
    size: candidates.length,
    // Inverse document frequency, clamped to a modest multiplier so it tunes
    // the existing integer score weights rather than dominating them: common
    // terms ~1.0, rare/discriminating terms up to ~3.0.
    idfFor(term) {
      const df = documentFrequency.get(term) ?? 0;
      const idf = 1 + Math.log(total / (1 + df));
      return Math.max(1, Math.min(3, idf));
    }
  };
}
