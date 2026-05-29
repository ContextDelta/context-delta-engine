import fs from "node:fs/promises";
import path from "node:path";
import { writeEvent } from "./observability.js";

// Markers delimit the region Context Delta owns. Everything outside them is the
// user's own content and is never touched.
export const MANAGED_BEGIN = "<!-- BEGIN CONTEXT DELTA: auto-generated, do not edit by hand -->";
export const MANAGED_END = "<!-- END CONTEXT DELTA -->";

const DEFAULT_INJECT_TARGETS = [".github/copilot-instructions.md", "AGENTS.md"];

// A compact, steering-only digest. It lists what to focus on and what to ignore
// using paths and spec headings, not full file bodies, so the auto-injected
// instruction file stays small while still scoping the agent.
export function renderInstructionDigest(packet) {
  const metrics = packet.metrics ?? {};
  const intent = packet.intent ?? {};
  const changed = (packet.changed_artifacts ?? [])
    .map((item) => item.path)
    .filter(Boolean);
  const specs = (packet.supporting_evidence ?? [])
    .filter((item) => item.type === "spec_section" || item.kind === "spec")
    .map((item) => (item.heading ? `${item.path}#${item.heading}` : item.path))
    .filter(Boolean);
  const tests = (packet.supporting_evidence ?? [])
    .filter((item) => item.kind === "test")
    .map((item) => item.path)
    .filter(Boolean);
  const rules = (packet.governing_constraints ?? [])
    .map((item) => (item.heading ? `${item.path}#${item.heading}` : item.path))
    .filter(Boolean);
  const impacted = (packet.impacted_neighbors ?? [])
    .map((item) => item.path)
    .filter(Boolean);
  const excluded = (packet.excluded ?? [])
    .filter((item) => item.path)
    .slice(0, 8)
    .map((item) => item.path);

  const wasted = metrics.wasted_tokens_estimate ?? metrics.tokens_saved_estimate ?? 0;
  const reduction = metrics.context_reduction_percent ?? 0;

  const lines = [
    "## Active task context (auto-maintained by Context Delta)",
    "",
    "Use the working set below as the focused context for the current change.",
    "Prefer these files, specs, and rules over broad repository guessing, and",
    "treat the excluded items as intentionally out of scope unless the task proves otherwise.",
    "",
    `- Task: ${intent.task ?? "(not set)"}`,
    `- Context health: risk=${packet.insights?.risk_level ?? "unknown"}, ~${wasted} naive-context tokens avoided (${reduction}% leaner than reading everything)`
  ];

  const specKit = packet.spec_kit;
  if (specKit?.detected && specKit.active_feature) {
    lines.push(`- Active Spec Kit feature: ${specKit.active_feature.id} (${specKit.active_feature.reason})`);
    if (specKit.constitution) {
      lines.push(`- Project constitution: ${specKit.constitution}`);
    }
    const otherFeatures = (specKit.features ?? []).filter((feature) => !feature.active).map((feature) => feature.id);
    if (otherFeatures.length) {
      lines.push(`- Other features out of scope for this task: ${otherFeatures.join(", ")}`);
    }
  }

  pushList(lines, "Focus on these changed files", changed);
  pushList(lines, "Relevant spec sections", specs);
  pushList(lines, "Related tests", tests);
  pushList(lines, "Repo rules in effect", rules);
  pushList(lines, "Likely impacted files", impacted);
  pushList(lines, "Out of scope for this task (excluded)", excluded);

  if (packet.warnings?.length) {
    lines.push("", "Watch items:");
    for (const warning of packet.warnings.slice(0, 5)) {
      lines.push(`- ${warning.message}`);
    }
  }

  // Deterministic footer (no timestamp/packet id) so an unchanged working set
  // produces an identical block and the file is not rewritten on every save.
  lines.push("", "_Maintained automatically by Context Delta. Edit only outside the markers._");
  return lines.join("\n");
}

function pushList(lines, title, items) {
  if (!items?.length) return;
  lines.push("", `${title}:`);
  for (const item of [...new Set(items)].slice(0, 12)) {
    lines.push(`- ${item}`);
  }
}

// Replaces the managed region in `existing`, or appends one if absent. Content
// outside the markers is preserved exactly.
export function upsertManagedBlock(existing, digest) {
  const managed = `${MANAGED_BEGIN}\n${digest.trim()}\n${MANAGED_END}`;
  const text = existing ?? "";
  const beginIndex = text.indexOf(MANAGED_BEGIN);
  const endIndex = text.indexOf(MANAGED_END);

  if (beginIndex !== -1 && endIndex !== -1 && endIndex > beginIndex) {
    const before = text.slice(0, beginIndex);
    const after = text.slice(endIndex + MANAGED_END.length);
    return `${before}${managed}${after}`;
  }

  if (!text.trim()) return `${managed}\n`;
  return `${text.replace(/\s*$/, "")}\n\n${managed}\n`;
}

async function readFileOrEmpty(absolutePath) {
  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch {
    return "";
  }
}

// Writes the digest into each configured instruction target. Idempotent: writing
// the same packet twice produces no further change.
export async function syncInstructionFiles(workspaceRoot, packet, config = {}) {
  const injectConfig = config.inject ?? {};
  if (injectConfig.enabled === false) {
    return { enabled: false, results: [] };
  }

  const targets = Array.isArray(injectConfig.targets) && injectConfig.targets.length
    ? injectConfig.targets
    : DEFAULT_INJECT_TARGETS;
  const digest = renderInstructionDigest(packet);
  const results = [];

  for (const target of targets) {
    const absolutePath = path.resolve(workspaceRoot, target);
    const existing = await readFileOrEmpty(absolutePath);
    const next = upsertManagedBlock(existing, digest);
    const changed = next !== existing;
    if (changed) {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, next);
    }
    results.push({
      target,
      path: absolutePath,
      changed,
      created: changed && !existing
    });
  }

  await writeEvent(workspaceRoot, "instructions_injected", {
    packet_id: packet.id,
    targets: results.map((result) => result.target),
    changed_targets: results.filter((result) => result.changed).map((result) => result.target)
  });

  return { enabled: true, results, digest };
}

export function getDefaultInjectTargets() {
  return [...DEFAULT_INJECT_TARGETS];
}
