import fs from "node:fs/promises";
import path from "node:path";
import { extractKeywords } from "./ranking.js";

// Local, privacy-safe feedback flywheel. When drift review finds that the agent
// edited a file the packet did NOT include, that's a ranking miss — the engine
// should have surfaced it for that task. We record (task keywords -> missed
// paths) locally and, on a future task with overlapping keywords, boost those
// paths so the previously-missed file is included proactively.
//
// This is the one improvement that compounds with a user's own usage and needs
// no external data: it only ever stores file paths and derived keywords, locally
// under .contextdelta/, never file contents.

const FEEDBACK_FILE = path.join(".contextdelta", "feedback.json");
const MAX_ENTRIES = 50;
const MAX_PATHS_PER_ENTRY = 20;

export async function recordFeedback(workspaceRoot, { task, missedPaths } = {}, options = {}) {
  if (options.enabled === false) return null;
  const paths = [...new Set((missedPaths ?? []).filter(Boolean))].slice(0, MAX_PATHS_PER_ENTRY);
  const keywords = extractKeywords(task ?? "");
  if (paths.length === 0 || keywords.length === 0) return null;

  const file = path.join(workspaceRoot, FEEDBACK_FILE);
  const entries = await readEntries(file);
  entries.push({ keywords, paths, ts: new Date().toISOString() });
  const trimmed = entries.slice(-MAX_ENTRIES);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify({ entries: trimmed, schema_version: "0.1" }, null, 2)}\n`);
  } catch {
    return null;
  }
  return { recorded_paths: paths.length };
}

// Returns a Map<path, overlapScore> of paths to boost for the current task,
// where a feedback entry's keywords overlap the current task's keywords.
export async function loadFeedbackBoosts(workspaceRoot, currentKeywords, options = {}) {
  if (options.enabled === false) return new Map();
  const entries = await readEntries(path.join(workspaceRoot, FEEDBACK_FILE));
  if (entries.length === 0) return new Map();
  const current = new Set(currentKeywords ?? []);
  const boosts = new Map();
  for (const entry of entries) {
    const overlap = (entry.keywords ?? []).filter((keyword) => current.has(keyword)).length;
    if (overlap <= 0) continue;
    for (const target of entry.paths ?? []) {
      boosts.set(target, Math.max(boosts.get(target) ?? 0, overlap));
    }
  }
  return boosts;
}

async function readEntries(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}
