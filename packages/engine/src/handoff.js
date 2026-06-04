import { buildCompactPacketView } from "./insights.js";
import { renderReplayPrompt } from "./approval.js";

export function renderHandoff(packet, options = {}) {
  const format = options.format ?? "markdown";
  if (format === "json") return `${JSON.stringify(packet, null, 2)}\n`;
  if (format === "compact" || format === "compact-json") {
    return `${JSON.stringify(packet.compact_view ?? buildCompactPacketView(packet), null, 2)}\n`;
  }
  if (format === "copilot") return renderCopilotMarkdown(packet);
  if (format === "spec-kit" || format === "speckit") return renderSpecKitMarkdown(packet);
  if (format === "replay") return renderReplayPrompt(packet);
  if (format === "incremental" || format === "delta") {
    return renderIncrementalMarkdown(packet, options.previousPacket ?? null);
  }
  return renderMarkdown(packet);
}

export function getSupportedHandoffFormats() {
  return ["markdown", "copilot", "spec-kit", "incremental", "compact", "json", "replay"];
}

// Buckets that carry agent-facing context, in handoff order.
const INCLUDED_BUCKETS = [
  ["governing_constraints", "Governing Constraints"],
  ["changed_artifacts", "Changed Artifacts"],
  ["supporting_evidence", "Supporting Evidence"],
  ["impacted_neighbors", "Impacted Neighbors"]
];

// Stable identity for a context item across turns. Mirrors history.js itemKey so
// the incremental handoff and the packet diff agree on what counts as "the same"
// item from one turn to the next.
function incrementalItemKey(item) {
  return [
    item.type ?? item.kind ?? "context",
    item.path ?? "unknown",
    item.heading ?? item.line_start ?? "",
    // Content fingerprint: a same-path item whose content CHANGED between turns
    // must count as new (re-sent), never as "retained, do not re-request" —
    // otherwise the agent keeps working from stale content across the loop.
    contentFingerprint(item)
  ].join(":");
}

function contentFingerprint(item) {
  const content = typeof item.content === "string" ? item.content : "";
  if (content.length === 0) return "";
  let hash = 5381;
  for (let i = 0; i < content.length; i += 1) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
  }
  return `${content.length}.${hash >>> 0}`;
}

function itemTokens(item) {
  if (Number.isFinite(item.tokens_estimate)) return item.tokens_estimate;
  return Math.ceil(String(item.content ?? "").length / 4);
}

function collectIncludedItems(packet) {
  const items = [];
  for (const [field, title] of INCLUDED_BUCKETS) {
    for (const item of packet?.[field] ?? []) {
      items.push({ ...item, _bucket: field, _bucketTitle: title });
    }
  }
  return items;
}

// Classifies the current packet's context against the previous turn's packet so a
// handoff can send only what is new or changed in full, reference what the agent
// already has, and note what dropped out of scope. Token figures are honest,
// byte-based estimates (the same basis as the waste meter), not tokenizer-exact.
export function buildIncrementalHandoffModel(currentPacket, previousPacket) {
  const currentItems = collectIncludedItems(currentPacket);
  const previousItems = collectIncludedItems(previousPacket ?? {});
  const previousKeys = new Set(previousItems.map(incrementalItemKey));
  const currentKeys = new Set(currentItems.map(incrementalItemKey));

  const newByBucket = new Map();
  const retained = [];
  let newTokens = 0;
  let retainedTokens = 0;

  for (const item of currentItems) {
    const tokens = itemTokens(item);
    if (previousKeys.has(incrementalItemKey(item))) {
      retained.push(item);
      retainedTokens += tokens;
    } else {
      if (!newByBucket.has(item._bucket)) {
        newByBucket.set(item._bucket, { title: item._bucketTitle, items: [] });
      }
      newByBucket.get(item._bucket).items.push(item);
      newTokens += tokens;
    }
  }

  // Genuinely dropped items only: a file whose content merely changed reappears
  // under a new key (re-sent above), so exclude any path still present this turn.
  const currentPaths = new Set(currentItems.map((item) => item.path).filter(Boolean));
  const removed = previousItems.filter(
    (item) => !currentKeys.has(incrementalItemKey(item)) && !(item.path && currentPaths.has(item.path))
  );
  const fullTokens = newTokens + retainedTokens;
  const savedPercent = fullTokens > 0 ? Number(((retainedTokens / fullTokens) * 100).toFixed(1)) : 0;

  return {
    has_previous: Boolean(previousPacket),
    previous_packet_id: previousPacket?.id ?? null,
    current_packet_id: currentPacket?.id ?? null,
    new_buckets: INCLUDED_BUCKETS.map(([field, title]) => ({
      field,
      title,
      items: newByBucket.get(field)?.items ?? []
    })).filter((bucket) => bucket.items.length > 0),
    retained,
    removed,
    tokens: {
      new_tokens_estimate: newTokens,
      retained_tokens_estimate: retainedTokens,
      full_handoff_tokens_estimate: fullTokens,
      saved_percent: savedPercent
    }
  };
}

function renderIncrementalMarkdown(packet, previousPacket) {
  const model = buildIncrementalHandoffModel(packet, previousPacket);

  if (!model.has_previous) {
    return [
      "# Context Delta Incremental Handoff",
      "",
      renderHeader(packet),
      "",
      "## Cross-Turn Note",
      "",
      "- No previous packet was found, so this is treated as the first turn.",
      "- The full working context is included below; later turns will send only what changed.",
      "",
      renderWarnings(packet),
      renderBucket("Governing Constraints", packet.governing_constraints),
      renderBucket("Changed Artifacts", packet.changed_artifacts),
      renderBucket("Supporting Evidence", packet.supporting_evidence),
      renderBucket("Impacted Neighbors", packet.impacted_neighbors),
      renderExcluded(packet)
    ].join("\n");
  }

  const t = model.tokens;
  return [
    "# Context Delta Incremental Handoff",
    "",
    renderHeader(packet),
    "",
    "## Cross-Turn Note",
    "",
    `- This is an incremental handoff relative to the previous packet (${model.previous_packet_id}).`,
    "- Items under \"Retained Context\" were already delivered last turn and are unchanged — keep using them and do not re-request them.",
    "- Only new or changed context is included in full below.",
    "",
    renderWarnings(packet),
    "## New And Changed Context",
    "",
    ...(model.new_buckets.length
      ? model.new_buckets.flatMap((bucket) => renderBucket(bucket.title, bucket.items).split("\n"))
      : ["No new or changed context this turn.", ""]),
    renderRetained(model.retained),
    renderRemoved(model.removed),
    "## Incremental Savings",
    "",
    `- Full handoff this turn would be ~${t.full_handoff_tokens_estimate} tokens (byte-based estimate).`,
    `- Sent incrementally: ~${t.new_tokens_estimate} tokens (new and changed only).`,
    `- Saved by not resending ${model.retained.length} retained item(s): ~${t.retained_tokens_estimate} tokens (${t.saved_percent}% smaller this turn).`,
    ""
  ].join("\n");
}

function renderRetained(items) {
  if (!items.length) return "## Retained Context\n\nNo retained context from the previous turn.\n";
  return [
    "## Retained Context",
    "",
    "Already in your context from the previous turn — unchanged, do not re-request:",
    "",
    ...items.map((item) => {
      const heading = item.heading ? `#${item.heading}` : "";
      const type = item.type ?? item.kind ?? "context";
      return `- ${item.path ?? "unknown"}${heading} (${type})`;
    }),
    ""
  ].join("\n");
}

function renderRemoved(items) {
  if (!items.length) return "## Dropped Since Last Turn\n\nNothing dropped out of scope.\n";
  return [
    "## Dropped Since Last Turn",
    "",
    "No longer in scope for the current task:",
    "",
    ...items.map((item) => {
      const heading = item.heading ? `#${item.heading}` : "";
      const type = item.type ?? item.kind ?? "context";
      return `- ${item.path ?? "unknown"}${heading} (${type})`;
    }),
    ""
  ].join("\n");
}

export function renderRiskHeader(packet) {
  const insight = packet.insights?.headline ?? "Context prepared.";
  const risk = packet.insights?.risk_level ?? "unknown";
  const budget = packet.budget?.pressure ?? "unknown";
  const warningCount = packet.warnings?.length ?? 0;
  const tests = packet.summary?.included_tests_count ?? 0;
  const specs = packet.summary?.included_spec_units_count ?? 0;
  const parts = [
    `Context ready`,
    `risk=${risk}`,
    `budget=${budget}`,
    `warnings=${warningCount}`,
    `tests=${tests}`,
    `specs=${specs}`
  ];
  return `${parts.join(" · ")}\n${insight}`;
}

function renderMarkdown(packet) {
  return [
    "# Context Delta Packet",
    "",
    renderHeader(packet),
    "",
    "## Operating Guidance",
    "",
    "- Use this packet as the focused working context.",
    "- Treat omitted files as intentionally out of scope unless the task proves otherwise.",
    "- Ask for expansion if a missing file, symbol, or test is required.",
    "",
    renderWarnings(packet),
    renderBucket("Governing Constraints", packet.governing_constraints),
    renderBucket("Changed Artifacts", packet.changed_artifacts),
    renderBucket("Supporting Evidence", packet.supporting_evidence),
    renderBucket("Impacted Neighbors", packet.impacted_neighbors),
    renderExcluded(packet)
  ].join("\n");
}

function renderCopilotMarkdown(packet) {
  return [
    "# Context Delta Handoff For GitHub Copilot",
    "",
    renderHeader(packet),
    "",
    "## Copilot Instructions",
    "",
    "- Prefer the changed artifacts, specs, tests, and repo instructions in this packet over broad repository guessing.",
    "- Keep edits scoped to the task and nearby affected files.",
    "- If a required file is absent, ask for expansion instead of inventing hidden context.",
    "- Respect any security or style constraints listed below.",
    "",
    renderWarnings(packet),
    renderBucket("Repo Instructions And Rules", packet.governing_constraints),
    renderBucket("Changed Files", packet.changed_artifacts),
    renderBucket("Specs And Behavior Evidence", packet.supporting_evidence),
    renderBucket("Likely Impacted Files", packet.impacted_neighbors),
    renderExcluded(packet)
  ].join("\n");
}

function renderSpecKitMarkdown(packet) {
  const specItems = packet.supporting_evidence.filter((item) =>
    ["spec", "spec_section"].includes(item.type) || item.kind === "spec"
  );
  const testItems = packet.supporting_evidence.filter((item) => item.kind === "test");
  const remainingEvidence = packet.supporting_evidence.filter(
    (item) => !specItems.includes(item) && !testItems.includes(item)
  );

  return [
    "# Context Delta Handoff For Spec-Driven Development",
    "",
    renderHeader(packet),
    "",
    "## Spec-Driven Guidance",
    "",
    "- Start from the spec sections and task list before changing code.",
    "- Keep implementation aligned with acceptance criteria.",
    "- Update or add tests for behavior changes.",
    "- Flag stale or conflicting requirements instead of silently choosing one.",
    "",
    renderWarnings(packet),
    renderBucket("Relevant Specs And Tasks", specItems),
    renderBucket("Changed Implementation Artifacts", packet.changed_artifacts),
    renderBucket("Related Tests", testItems),
    renderBucket("Repo Instructions", packet.governing_constraints),
    renderBucket("Other Supporting Evidence", remainingEvidence),
    renderBucket("Impacted Neighbors", packet.impacted_neighbors),
    renderExcluded(packet)
  ].join("\n");
}

function renderHeader(packet) {
  const insight = packet.insights?.headline ?? "No packet insight available.";
  const risk = packet.insights?.risk_level ?? "unknown";
  const budget = packet.budget?.pressure ?? "unknown";

  return [
    `Task: ${packet.intent?.task ?? ""}`,
    `Packet ID: ${packet.id ?? "unknown"}`,
    `Insight: ${insight}`,
    `Risk: ${risk}`,
    `Budget pressure: ${budget}`,
    `Delivered context tokens: ${packet.metrics?.delivered_tokens_estimate ?? packet.metrics?.packet_tokens_estimate ?? "unknown"}`,
    `Naive context tokens (estimated): ${packet.metrics?.baseline_tokens_estimate ?? "unknown"}`,
    `Wasted context avoided: ${packet.metrics?.wasted_tokens_estimate ?? packet.metrics?.tokens_saved_estimate ?? "unknown"}`,
    `Context reduction: ${packet.metrics?.context_reduction_percent ?? 0}%`,
    `Useful-context density: ${packet.metrics?.heuristic_useful_context_density_percent ?? "unknown"}%`
  ].join("\n");
}

function renderWarnings(packet) {
  if (!packet.warnings?.length) {
    return "## Warnings\n\nNo warnings.\n";
  }

  return [
    "## Warnings",
    "",
    ...packet.warnings.map((warning) => `- ${warning.type}: ${warning.message}`),
    ""
  ].join("\n");
}

function renderBucket(title, items) {
  if (!items?.length) return `## ${title}\n\nNo items.\n`;
  return [
    `## ${title}`,
    "",
    ...items.flatMap((item) => renderItem(item)),
    ""
  ].join("\n");
}

function renderItem(item) {
  const heading = item.heading ? `#${item.heading}` : "";
  const lines = [
    `### ${item.path ?? "unknown"}${heading}`,
    "",
    `Reason: ${item.reason ?? "No reason recorded."}`,
    `Type: ${item.type ?? item.kind ?? "context"}`,
    ""
  ];

  if (item.content) {
    const fence = getFence(item.content);
    lines.push(`${fence}text`, item.content, fence, "");
  }

  return lines;
}

function getFence(content) {
  return String(content).includes("```") ? "````" : "```";
}

function renderExcluded(packet) {
  if (!packet.excluded?.length) return "## Excluded Context\n\nNo excluded context recorded.\n";
  return [
    "## Excluded Context",
    "",
    ...packet.excluded.slice(0, 25).map((item) => {
      const type = item.type ?? item.kind ?? "context";
      return `- ${item.path ?? "unknown"} (${type}) - ${item.reason ?? ""}`;
    }),
    ""
  ].join("\n");
}
