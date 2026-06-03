import { readFileSnippet } from "./scanner.js";

// Spec freshness intelligence. Spec piles accumulate: old requirements get
// marked deprecated/superseded but stay in the repo. Feeding a stale requirement
// to an agent is worse than feeding none, so we detect those markers and keep
// the stale spec OUT of the packet (with a reason), rather than silently ranking
// it in next to the current one. Deterministic and content-based — no model.

// Statuses that mean "do not use this requirement". `draft` is deliberately
// excluded — a draft is often the active work, not stale.
const STALE_STATUSES = new Set([
  "deprecated",
  "superseded",
  "obsolete",
  "retired",
  "archived",
  "replaced"
]);

const STATUS_RE =
  /(?:^|\n)[^\S\n]*(?:#{1,6}\s*)?(?:status|state)\s*[:=]\s*["'`]?(deprecated|superseded|obsolete|retired|archived|replaced|draft|accepted|active|current)\b/i;
const HEADING_RE = /(?:^|\n)#{1,6}\s*(deprecated|superseded|obsolete|archived)\b/i;
const PHRASE_RE =
  /\b(?:this (?:spec|document|requirement) is (?:deprecated|obsolete|superseded|no longer valid)|no longer (?:used|valid|maintained)|do not use|superseded by|replaced by)\b/i;

export function detectSpecStatus(content) {
  const text = String(content ?? "");
  const statusMatch = text.match(STATUS_RE);
  if (statusMatch) return statusMatch[1].toLowerCase();
  const headingMatch = text.match(HEADING_RE);
  if (headingMatch) return headingMatch[1].toLowerCase();
  if (PHRASE_RE.test(text)) return "deprecated";
  return null;
}

export function isStaleStatus(status) {
  return Boolean(status) && STALE_STATUSES.has(status);
}

// Reviews the given spec files (read once each, capped) and returns those whose
// content marks them as a stale requirement.
export async function reviewSpecs(specFiles, options = {}) {
  const snippetChars = options.snippetChars ?? 8_000;
  const deprecated = [];
  for (const file of specFiles) {
    let content = "";
    try {
      content = await readFileSnippet(file, { maxChars: snippetChars });
    } catch {
      content = "";
    }
    const status = detectSpecStatus(content);
    if (isStaleStatus(status)) {
      deprecated.push({ path: file.path, status });
    }
  }
  return { deprecated };
}
