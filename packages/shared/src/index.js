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

export function estimateTokensForText(text) {
  if (!text) return 0;
  const normalized = String(text).trim();
  if (!normalized) return 0;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const charEstimate = Math.ceil(normalized.length / 4);
  return Math.max(wordCount, charEstimate);
}

export function estimateTokensForJson(value) {
  return estimateTokensForText(JSON.stringify(value, null, 2));
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

