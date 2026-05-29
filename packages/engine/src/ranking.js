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

export function scoreFile(file, keywords, changedPaths = new Set()) {
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

  for (const keyword of keywords) {
    if (lowerPath.includes(keyword)) score += 12;
    if (basename.includes(keyword)) score += 8;
  }

  if (/auth|token|security|permission|role|admin/.test(keywordText)) {
    if (/auth|token|security|permission|role|admin/.test(lowerPath)) score += 16;
  }

  return score;
}

export function pickRankedFiles(files, keywords, changedPaths, options = {}) {
  const limit = options.limit ?? 12;
  const excludeKinds = new Set(options.excludeKinds ?? []);
  const includeKinds = options.includeKinds ? new Set(options.includeKinds) : null;

  return files
    .filter((file) => file.textLike && !file.tooLarge)
    .filter((file) => !excludeKinds.has(file.kind))
    .filter((file) => !includeKinds || includeKinds.has(file.kind))
    .map((file) => ({
      file,
      score: scoreFile(file, keywords, changedPaths)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.file.path.localeCompare(b.file.path);
    })
    .slice(0, limit);
}

export function explainFileInclusion(file, changedPaths, keywords) {
  if (changedPaths.has(file.path)) return "Changed in the current workspace delta";
  if (file.kind === "instruction") return "Repository or agent instruction that may govern the task";
  if (file.kind === "test") return "Nearby test or behavior check related to the task";
  if (file.kind === "spec") return "Spec-driven artifact related to the task";

  const matched = keywords.filter((keyword) => file.path.toLowerCase().includes(keyword));
  if (matched.length) return `Path matches task keyword(s): ${matched.join(", ")}`;
  return "Ranked as relevant by file type, recency, or proximity";
}
