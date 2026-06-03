#!/usr/bin/env node
// Renders a PRIVACY-SAFE Context Delta packet summary for posting as a pull
// request comment: the working set (paths + why each was included), what was
// excluded and why, and the token economics — but never raw file contents.
// This makes the agent's working context a reviewable team artifact, the same
// way a diff is. Used by .github/workflows/context-packet.yml.
//
// Usage: node scripts/pr-context-comment.mjs [task...] [--workspace DIR]

import {
  buildContextPacket,
  getUniqueIncludedItems,
  inferWorkspaceIntent,
  renderRiskHeader
} from "../packages/engine/src/index.js";

const MARKER = "<!-- context-delta-packet -->";

function takeFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return { value: null, rest: argv };
  return { value: argv[i + 1], rest: [...argv.slice(0, i), ...argv.slice(i + 2)] };
}

async function main() {
  const { value: workspaceFlag, rest } = takeFlag(process.argv.slice(2), "--workspace");
  const workspaceRoot = workspaceFlag ?? process.env.CONTEXT_DELTA_WORKSPACE ?? process.cwd();
  const task = rest.join(" ").trim() || (await inferWorkspaceIntent(workspaceRoot));

  const { packet } = await buildContextPacket({ task, updateSnapshot: false, workspaceRoot });
  const m = packet.metrics;
  const included = dedupeByPath(getUniqueIncludedItems(packet).filter((item) => item.path));
  const excluded = dedupeByPath((packet.excluded ?? []).filter((item) => item.path));
  const naive = m.baselines?.naive_agent;

  const lines = [
    MARKER,
    "## Context Delta — prepared context for this PR",
    "",
    `**${renderRiskHeader(packet).split("\n")[0]}**`,
    "",
    `Delivered **${m.delivered_tokens_estimate} tokens** vs a naive-agent baseline of ` +
      `**${naive?.tokens_estimate ?? m.baseline_tokens_estimate}** ` +
      `(**${naive?.reduction_percent ?? m.context_reduction_percent}% smaller**), ` +
      `counted with ${m.token_count_method === "exact_tokenizer" ? "an exact tokenizer" : "a heuristic estimate"}.`,
    "",
    `<details><summary><b>Included context (${included.length})</b> — what the agent should work from</summary>`,
    "",
    "| File | Why |",
    "| --- | --- |",
    ...included.slice(0, 40).map((item) => `| \`${item.path}\` | ${oneLine(item.reason)} |`),
    "",
    "</details>"
  ];

  if (excluded.length) {
    lines.push(
      "",
      `<details><summary><b>Excluded (${excluded.length})</b> — left out on purpose</summary>`,
      "",
      "| File | Reason |",
      "| --- | --- |",
      ...excluded.slice(0, 20).map((item) => `| \`${item.path}\` | ${oneLine(item.reason)} |`),
      "",
      "</details>"
    );
  }

  lines.push(
    "",
    "<sub>Local-first: this packet was assembled on the runner from the diff, specs, tests, and instructions. No file contents are posted here — only the working set and why. Reproduce with `npm run prepare -- \"<task>\"`.</sub>"
  );

  process.stdout.write(`${lines.join("\n")}\n`);
}

// Collapse multiple entries for the same file (e.g. several matched spec
// sections) into one row, keeping the first/most-specific reason.
function dedupeByPath(items) {
  const byPath = new Map();
  for (const item of items) {
    if (!byPath.has(item.path)) byPath.set(item.path, item);
  }
  return [...byPath.values()];
}

function oneLine(text) {
  return String(text ?? "ranked as relevant").replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 160);
}

main().catch((error) => {
  console.error("PR context comment error:", error);
  process.exit(1);
});
