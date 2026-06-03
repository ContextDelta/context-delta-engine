import path from "node:path";

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "but",
  "can",
  "change",
  "code",
  "for",
  "from",
  "how",
  "into",
  "make",
  "need",
  "that",
  "the",
  "this",
  "use",
  "what",
  "when",
  "with",
  "your"
]);

export function extractKeywords(task) {
  return [
    ...new Set(
      String(task)
        .toLowerCase()
        .split(/[^a-z0-9_/-]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 2 && !STOPWORDS.has(part))
    )
  ];
}

export function derivePathKeywords(paths) {
  return [
    ...new Set(
      [...paths]
        .flatMap((filePath) =>
          String(filePath)
            .toLowerCase()
            .split(/[^a-z0-9_]+/)
        )
        .map((part) => part.trim())
        .filter((part) => part.length > 2 && !STOPWORDS.has(part))
    )
  ];
}

export function scoreFile(file, keywords, changedPaths = new Set(), index = null) {
  let score = 0;
  const lowerPath = file.path.toLowerCase();
  const basename = path.posix.basename(lowerPath);

  if (changedPaths.has(file.path)) score += 100;
  if (file.kind === "instruction") score += 30;
  if (file.kind === "spec") score += 20;
  if (file.kind === "test") score += 12;
  if (file.kind === "source") score += 8;
  if (file.kind === "doc") score += 4;

  const keywordText = keywords.join(" ");
  if (/(page|pages|github|site|visual|ui|responsive|layout|css|html|browser)/.test(keywordText)) {
    if (/\.(html|css|scss|sass|js|ts|jsx|tsx)$/.test(lowerPath)) score += 24;
    if (/(^|\/)(site|public|pages|static|assets)\//.test(lowerPath)) score += 36;
    if (basename === "index.html") score += 24;
  }

  // Content- and symbol-aware relevance, IDF-weighted. When a relevance index
  // is supplied, the ranker reads what each file actually contains and defines,
  // not just its path — and rare, discriminating task terms count for more.
  // This generalizes domain relevance (auth, payments, billing, ...) from the
  // repo's own content instead of a hardcoded keyword regex.
  const entry = index?.byPath?.get(file.path) ?? null;
  for (const keyword of keywords) {
    const weight = index ? index.idfFor(keyword) : 1;
    if (lowerPath.includes(keyword)) score += 12 * weight;
    if (basename.includes(keyword)) score += 8 * weight;
    if (entry) {
      if (entry.symbolTerms.has(keyword)) score += 14 * weight;
      const mentions = entry.termCounts.get(keyword) ?? 0;
      if (mentions > 0) score += Math.min(mentions, 3) * 4 * weight;
    }
  }

  return Math.round(score);
}

export function pickRankedFiles(files, keywords, changedPaths, options = {}) {
  const limit = options.limit ?? 12;
  const excludeKinds = new Set(options.excludeKinds ?? []);
  const includeKinds = options.includeKinds ? new Set(options.includeKinds) : null;
  const index = options.index ?? null;
  // When set, only surface files that have an actual task signal (changed,
  // path/name, content, or symbol match) rather than the bare file-kind floor.
  // Used for impacted neighbors so unrelated same-kind modules don't fill the
  // packet on kind weight alone.
  const requireSignal = options.requireSignal === true;

  return files
    .filter((file) => file.textLike && !file.tooLarge)
    .filter((file) => !excludeKinds.has(file.kind))
    .filter((file) => !includeKinds || includeKinds.has(file.kind))
    .filter((file) => !requireSignal || hasRelevanceSignal(file, keywords, changedPaths, index))
    .map((file) => ({
      file,
      score: scoreFile(file, keywords, changedPaths, index)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.file.path.localeCompare(b.file.path);
    })
    .slice(0, limit);
}

// True when the task actually touches this file — changed, a path/name match, or
// (with an index) a content or declared-symbol match. Distinguishes real
// relevance from the baseline file-kind weight every file of a kind receives.
export function hasRelevanceSignal(file, keywords, changedPaths = new Set(), index = null) {
  if (changedPaths.has(file.path)) return true;
  const lowerPath = file.path.toLowerCase();
  const entry = index?.byPath?.get(file.path) ?? null;
  for (const keyword of keywords) {
    if (lowerPath.includes(keyword)) return true;
    if (entry && (entry.symbolTerms.has(keyword) || entry.termCounts.has(keyword))) return true;
  }
  return false;
}

export function explainFileInclusion(file, changedPaths, keywords, index = null) {
  if (changedPaths.has(file.path)) return "Changed in the current workspace delta";
  if (file.kind === "instruction") return "Repository or agent instruction that may govern the task";
  if (file.kind === "test") return "Nearby test or behavior check related to the task";
  if (file.kind === "spec") return "Spec-driven artifact related to the task";

  const matchedPath = keywords.filter((keyword) => file.path.toLowerCase().includes(keyword));
  if (matchedPath.length) return `Path matches task keyword(s): ${matchedPath.join(", ")}`;

  const entry = index?.byPath?.get(file.path) ?? null;
  if (entry) {
    const matchedSymbol = keywords.filter((keyword) => entry.symbolTerms.has(keyword));
    if (matchedSymbol.length) {
      return `Defines symbol(s) matching the task: ${matchedSymbol.join(", ")}`;
    }
    const matchedContent = keywords.filter((keyword) => entry.termCounts.has(keyword));
    if (matchedContent.length) {
      return `Content references task keyword(s): ${matchedContent.slice(0, 4).join(", ")}`;
    }
  }
  return "Ranked as relevant by file type, recency, or proximity";
}
