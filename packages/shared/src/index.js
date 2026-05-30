import { createRequire } from "node:module";

export const PACKET_SCHEMA_VERSION = "0.1";
export const METRICS_SCHEMA_VERSION = "0.1";

export function toPosixPath(value) {
  return value.replaceAll("\\", "/");
}

export function normalizeRelativePath(value) {
  return toPosixPath(value).replace(/^\.?\//, "");
}

export function createStableId(parts) {
  return parts
    .filter(Boolean)
    .join(":")
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// gpt-tokenizer is an optional dependency. When installed, token counts are
// exact for the o200k_base encoding (the GPT-4o family), a good representative
// for modern coding agents. When absent (e.g. a fresh checkout before
// `npm install`), we fall back to a fast character/word heuristic so the engine
// still runs with zero hard dependencies.
const requireOptional = createRequire(import.meta.url);
let tokenizer = null;
let tokenizerModel = "heuristic";
let tokenizerLoaded = false;

function loadTokenizer() {
  if (tokenizerLoaded) return tokenizer;
  tokenizerLoaded = true;
  try {
    tokenizer = requireOptional("gpt-tokenizer");
    tokenizerModel = "gpt-tokenizer/o200k_base";
  } catch {
    tokenizer = null;
    tokenizerModel = "heuristic";
  }
  return tokenizer;
}

// Bounded cache so identical content (e.g. a file delivered in the packet and
// also counted in the baseline) is only tokenized once per process.
const tokenCountCache = new Map();
const TOKEN_CACHE_LIMIT = 4000;

function heuristicTokenCount(normalized) {
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const charEstimate = Math.ceil(normalized.length / 4);
  return Math.max(wordCount, charEstimate);
}

export function estimateTokensForText(text) {
  if (!text) return 0;
  const normalized = String(text).trim();
  if (!normalized) return 0;

  const cached = tokenCountCache.get(normalized);
  if (cached !== undefined) return cached;

  const engine = loadTokenizer();
  let count;
  if (engine) {
    try {
      count = engine.countTokens(normalized);
    } catch {
      count = heuristicTokenCount(normalized);
    }
  } else {
    count = heuristicTokenCount(normalized);
  }

  if (tokenCountCache.size >= TOKEN_CACHE_LIMIT) tokenCountCache.clear();
  tokenCountCache.set(normalized, count);
  return count;
}

export function estimateTokensForJson(value) {
  return estimateTokensForText(JSON.stringify(value, null, 2));
}

// Reports whether token counts are exact (real tokenizer available) or a
// heuristic fallback, so the packet can be transparent about how it measured.
export function getTokenizerInfo() {
  loadTokenizer();
  return {
    method: tokenizer ? "exact_tokenizer" : "heuristic",
    model: tokenizerModel
  };
}

export function percentReduction(before, after) {
  if (!before || before <= 0) return 0;
  return Math.max(0, Math.min(100, ((before - after) / before) * 100));
}

export function formatPercent(value) {
  return `${Math.round(value)}%`;
}

export function nowIso() {
  return new Date().toISOString();
}

