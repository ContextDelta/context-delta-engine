import fs from "node:fs/promises";
import path from "node:path";
import {
  METRICS_SCHEMA_VERSION,
  estimateTokensForJson,
  estimateTokensForText,
  getTokenizerInfo,
  nowIso,
  percentReduction
} from "../../shared/src/index.js";
import { buildPacketDiff } from "./history.js";
import { writeEvent } from "./observability.js";

export const DEFAULT_BASELINE_MODEL = {
  strategy: "naive_agent_context_model",
  openRecentFiles: 6,
  chatHistoryTokens: 2000,
  includeAllSpecs: true,
  includeAllInstructions: true
};

export function buildPacketMetrics(packetDraft, files, baselineConfig = {}, tokenizerModel = null) {
  const model = { ...DEFAULT_BASELINE_MODEL, ...baselineConfig };
  const packetTokensEstimate = estimateTokensForJson(packetDraft, tokenizerModel);
  const delivered = estimateDeliveredTokens(packetDraft, tokenizerModel);
  const deliveredTokensEstimate = delivered.tokens;
  // Calibrate bytes->tokens from this packet's own delivered content (exact
  // tokenizer counts vs. real character counts), so the size-derived baseline
  // uses the same measure as the delivered count instead of a fixed ratio.
  const charsPerToken = delivered.calibrationTokens > 0
    ? clampCharsPerToken(delivered.calibrationChars / delivered.calibrationTokens)
    : DEFAULT_CHARS_PER_TOKEN;
  const naive = estimateNaiveAgentBaseline(files, packetDraft, model, charsPerToken, tokenizerModel);
  const workspaceUpperBound = estimateWorkspaceUpperBound(files, charsPerToken);
  const openFilesTokens = estimateOpenFilesBaseline(files, packetDraft, model, charsPerToken, tokenizerModel);
  // The naive baseline is the headline "before". Guard only against degenerate
  // cases where it would dip below what we actually deliver.
  const baselineTokensEstimate = Math.max(
    naive.total,
    Math.ceil(deliveredTokensEstimate * 1.05)
  );
  const wastedTokensEstimate = Math.max(0, baselineTokensEstimate - deliveredTokensEstimate);
  const usefulDensity = estimateUsefulContextDensity(packetDraft);
  const tokenizerInfo = getTokenizerInfo(tokenizerModel);

  // Multiple transparent baselines instead of a single number, so the savings
  // claim cannot be dismissed as cherry-picked. They bracket the honest range
  // and are constructed to stay monotonic (floor <= typical <= ceiling): the
  // open-files set is a subset of the naive set, and the whole-repo set is a
  // superset, all sharing the same chat/task allowance.
  const chatHistoryTokens = Math.max(0, Math.round(model.chatHistoryTokens ?? 0));
  const taskTokens = estimateTokensForText(packetDraft.intent?.task ?? "", tokenizerModel);
  const floorTokens = Math.min(openFilesTokens, naive.total);
  const wholeRepoTotal = Math.max(workspaceUpperBound + chatHistoryTokens + taskTokens, naive.total);
  const baselines = {
    open_files_only: makeBaseline(
      floorTokens,
      deliveredTokensEstimate,
      "Conservative floor: a disciplined developer who shares only the changed and most recently edited files (no specs, instructions, or chat history)."
    ),
    naive_agent: makeBaseline(
      naive.total,
      deliveredTokensEstimate,
      "Typical case (headline): an agent that also pulls full spec files, instruction files, and a chat-history allowance."
    ),
    whole_repo: makeBaseline(
      wholeRepoTotal,
      deliveredTokensEstimate,
      "Upper bound: the entire directly-useful repository text plus the same allowance."
    )
  };

  return {
    baseline_note:
      "Reduction is reported against several transparent baselines (see `baselines`): a conservative open-files floor, the typical naive-agent case (headline), and a whole-repo upper bound. Delivered tokens are measured with a real tokenizer when available; size-derived baselines are converted using chars_per_token_estimate, calibrated from this packet's own content.",
    baseline_strategy: model.strategy,
    baseline_tokens_estimate: baselineTokensEstimate,
    baseline_breakdown: naive.breakdown,
    baseline_counts: naive.counts,
    baseline_assumptions: naive.assumptions,
    baselines,
    chars_per_token_estimate: Number(charsPerToken.toFixed(2)),
    context_reduction_percent: Number(
      percentReduction(baselineTokensEstimate, deliveredTokensEstimate).toFixed(1)
    ),
    delivered_tokens_estimate: deliveredTokensEstimate,
    heuristic_useful_context_density_percent: usefulDensity.percent,
    token_count_method: tokenizerInfo.method,
    tokenizer_model: tokenizerInfo.model,
    tokenizer_encoding: tokenizerInfo.encoding,
    target_model: tokenizerInfo.targetModel,
    useful_items_estimate: usefulDensity.usefulItems,
    packet_tokens_estimate: packetTokensEstimate,
    wasted_tokens_estimate: wastedTokensEstimate,
    tokens_saved_estimate: wastedTokensEstimate,
    workspace_upper_bound_tokens_estimate: workspaceUpperBound
  };
}

const DEFAULT_CHARS_PER_TOKEN = 4;

function makeBaseline(tokens, deliveredTokens, note) {
  const tokensEstimate = Math.max(0, Math.round(tokens));
  return {
    tokens_estimate: tokensEstimate,
    reduction_percent: Number(percentReduction(tokensEstimate, deliveredTokens).toFixed(1)),
    note
  };
}

// Conservative floor: only the changed files plus the most recently edited
// files (the "open tabs" a careful developer would paste), with no specs,
// instructions, or chat-history allowance. Reduction against this is the
// smallest, most defensible claim.
function estimateOpenFilesBaseline(files, packetDraft, model, charsPerToken, tokenizerModel) {
  const textFiles = files.filter((file) => file.textLike && !file.tooLarge);
  const changedPaths = new Set((packetDraft.changed_artifacts ?? []).map((artifact) => artifact.path));
  const recent = textFiles
    .filter((file) => ["source", "test", "doc"].includes(file.kind))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, Math.max(0, model.openRecentFiles ?? 0));

  const seen = new Set();
  let bytes = 0;
  for (const file of textFiles) {
    if (changedPaths.has(file.path) && !seen.has(file.path)) {
      seen.add(file.path);
      bytes += file.size;
    }
  }
  for (const file of recent) {
    if (!seen.has(file.path)) {
      seen.add(file.path);
      bytes += file.size;
    }
  }

  const taskTokens = estimateTokensForText(packetDraft.intent?.task ?? "", tokenizerModel);
  return tokensFromBytes(bytes, charsPerToken) + taskTokens;
}

// Keep the calibrated ratio in a sane range so an unusual packet (e.g. mostly
// whitespace or mostly symbols) cannot distort the baseline.
function clampCharsPerToken(value) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_CHARS_PER_TOKEN;
  return Math.min(6, Math.max(2.5, value));
}

// Tokens actually handed to the agent (included item content), as opposed to the
// full serialized packet (which also carries audit metadata never sent to the agent).
function estimateDeliveredTokens(packetDraft, tokenizerModel) {
  const included = [
    ...(packetDraft.changed_artifacts ?? []),
    ...(packetDraft.governing_constraints ?? []),
    ...(packetDraft.impacted_neighbors ?? []),
    ...(packetDraft.supporting_evidence ?? [])
  ];
  const seen = new Set();
  let total = 0;
  // Calibration accumulators only count items where we have the real text, so
  // chars_per_token reflects actual content rather than items that only carry a
  // precomputed estimate.
  let calibrationChars = 0;
  let calibrationTokens = 0;
  for (const item of included) {
    const key = [item.type ?? item.kind ?? "item", item.path ?? "", item.heading ?? item.line_start ?? ""].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    if (typeof item.content === "string" && item.content.length > 0) {
      const tokens = estimateTokensForText(item.content, tokenizerModel);
      total += tokens;
      calibrationChars += item.content.length;
      calibrationTokens += tokens;
    } else if (Number.isFinite(item.tokens_estimate)) {
      total += item.tokens_estimate;
    }
  }
  return { tokens: total, calibrationChars, calibrationTokens };
}

export async function writePacketAndMetrics(workspaceRoot, packet) {
  const timestamp = packet.created_at.replace(/[:.]/g, "-");
  const packetDir = path.join(workspaceRoot, ".contextdelta", "packets");
  const reportsDir = path.join(workspaceRoot, ".contextdelta", "reports");
  const packetPath = path.join(packetDir, `${timestamp}-${packet.id}.json`);
  const latestPath = path.join(packetDir, "latest.json");
  const latestDiffPath = path.join(packetDir, "latest-diff.json");
  const metricsPath = path.join(reportsDir, "session-metrics.jsonl");
  const previousPacket = await safeReadPacket(latestPath);

  await fs.mkdir(packetDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`);
  await fs.writeFile(latestPath, `${JSON.stringify(packet, null, 2)}\n`);
  if (previousPacket?.id && previousPacket.id !== packet.id) {
    await fs.writeFile(
      latestDiffPath,
      `${JSON.stringify(buildPacketDiff(previousPacket, packet), null, 2)}\n`
    );
  }
  await fs.appendFile(metricsPath, `${JSON.stringify(createMetricsEvent(packet))}\n`);
  await writeEvent(workspaceRoot, "packet_written", {
    packet_id: packet.id,
    packet_tokens_estimate: packet.metrics.packet_tokens_estimate,
    tokens_saved_estimate: packet.metrics.tokens_saved_estimate
  });

  return {
    latestPath,
    latestDiffPath: previousPacket?.id && previousPacket.id !== packet.id ? latestDiffPath : null,
    metricsPath,
    packetPath
  };
}

export async function readMetricsSummary(workspaceRoot, options = {}) {
  const metricsPath = path.join(workspaceRoot, ".contextdelta", "reports", "session-metrics.jsonl");
  try {
    const raw = await fs.readFile(metricsPath, "utf8");
    const events = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    return summarizeMetrics(windowEvents(events, options));
  } catch {
    return summarizeMetrics([]);
  }
}

// Optional time/recency window so the rollup reflects current behavior instead
// of all history forever. `since` keeps events at or after a date; `limit`
// keeps only the most recent N events.
function windowEvents(events, { since, limit } = {}) {
  let windowed = events;
  const sinceTime = since ? Date.parse(since) : NaN;
  if (Number.isFinite(sinceTime)) {
    windowed = windowed.filter((event) => {
      const eventTime = Date.parse(event.timestamp ?? event.created_at ?? "");
      return Number.isFinite(eventTime) ? eventTime >= sinceTime : true;
    });
  }
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    windowed = windowed.slice(-Math.floor(Number(limit)));
  }
  return windowed;
}

export async function readMetricsEvents(workspaceRoot) {
  const metricsPath = path.join(workspaceRoot, ".contextdelta", "reports", "session-metrics.jsonl");
  try {
    const raw = await fs.readFile(metricsPath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function buildManagerSummary(workspaceRoot, options = {}) {
  const events = await readMetricsEvents(workspaceRoot);
  const since = options.since ? new Date(options.since) : null;
  const filtered = Number.isFinite(since?.getTime())
    ? events.filter((event) => new Date(event.timestamp ?? event.created_at ?? 0) >= since)
    : events;
  const summary = summarizeMetrics(filtered);
  const total = summary.sessions || 1;

  return {
    generated_at: nowIso(),
    period: {
      label: options.label ?? (since ? `Since ${since.toISOString()}` : "All local sessions"),
      since: since?.toISOString() ?? null
    },
    recommendations: buildManagerRecommendations(summary),
    summary: {
      ...summary,
      low_risk_percent: percentOf(summary.risk_counts.low ?? 0, total),
      over_budget_percent: percentOf(summary.budget_pressure_counts.over ?? 0, total)
    },
    workspace_root: workspaceRoot
  };
}

export async function writeManagerSummary(workspaceRoot, options = {}) {
  const reportsDir = path.join(workspaceRoot, ".contextdelta", "reports");
  const summary = await buildManagerSummary(workspaceRoot, options);
  const jsonPath = path.join(reportsDir, "weekly-summary.json");
  const markdownPath = path.join(reportsDir, "weekly-summary.md");
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  await fs.writeFile(markdownPath, renderManagerSummaryMarkdown(summary));
  await writeEvent(workspaceRoot, "manager_summary_written", {
    json_path: jsonPath,
    markdown_path: markdownPath,
    sessions: summary.summary.sessions
  });
  return {
    jsonPath,
    markdownPath,
    summary
  };
}

export function renderManagerSummaryMarkdown(managerSummary) {
  const summary = managerSummary.summary;
  return [
    "# Context Delta Repo Summary",
    "",
    `Generated: ${managerSummary.generated_at}`,
    `Period: ${managerSummary.period.label}`,
    "",
    "## Executive Signals",
    "",
    `- Sessions: ${summary.sessions}`,
    `- Estimated tokens saved: ${summary.tokens_saved_estimate}`,
    `- Average context reduction: ${summary.average_context_reduction_percent}%`,
    `- Average useful-context density: ${summary.average_useful_context_density_percent}%`,
    `- Average packet size: ${summary.average_packet_tokens_estimate} tokens`,
    `- Low-risk packets: ${summary.low_risk_percent}%`,
    `- Over-budget packets: ${summary.over_budget_percent}%`,
    `- Redactions applied: ${summary.redactions_applied}`,
    `- Stale spec warnings: ${summary.stale_spec_warnings}`,
    "",
    "## Risk Mix",
    "",
    renderCounts(summary.risk_counts),
    "",
    "## Budget Mix",
    "",
    renderCounts(summary.budget_pressure_counts),
    "",
    "## Recommendations",
    "",
    ...managerSummary.recommendations.map((recommendation) => `- ${recommendation}`),
    ""
  ].join("\n");
}

function tokensFromBytes(bytes, charsPerToken = DEFAULT_CHARS_PER_TOKEN) {
  const ratio = charsPerToken > 0 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN;
  return Math.ceil(Math.max(0, bytes) / ratio);
}

// Models what a naive agent (e.g. Copilot reading open tabs + whole specs) would
// likely pull into context for this task, so "wasted tokens" reflects a realistic
// before-state rather than the entire repository.
function estimateNaiveAgentBaseline(files, packetDraft, model, charsPerToken = DEFAULT_CHARS_PER_TOKEN, tokenizerModel = null) {
  const textFiles = files.filter((file) => file.textLike && !file.tooLarge);
  const changedPaths = new Set(
    (packetDraft.changed_artifacts ?? []).map((artifact) => artifact.path)
  );
  const recentPaths = new Set(
    textFiles
      .filter((file) => ["source", "test", "doc"].includes(file.kind))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, Math.max(0, model.openRecentFiles ?? 0))
      .map((file) => file.path)
  );

  const breakdown = {
    changed_files_tokens: 0,
    full_specs_tokens: 0,
    instructions_tokens: 0,
    open_recent_files_tokens: 0
  };
  const counts = {
    changed_files: 0,
    full_specs: 0,
    instructions: 0,
    open_recent_files: 0
  };
  const seen = new Set();

  function take(file, tokensKey, countKey) {
    if (seen.has(file.path)) return;
    seen.add(file.path);
    breakdown[tokensKey] += tokensFromBytes(file.size, charsPerToken);
    counts[countKey] += 1;
  }

  // Priority order avoids double counting a file across buckets.
  for (const file of textFiles) {
    if (changedPaths.has(file.path)) take(file, "changed_files_tokens", "changed_files");
  }
  if (model.includeAllSpecs !== false) {
    for (const file of textFiles) {
      if (file.kind === "spec") take(file, "full_specs_tokens", "full_specs");
    }
  }
  if (model.includeAllInstructions !== false) {
    for (const file of textFiles) {
      if (file.kind === "instruction") take(file, "instructions_tokens", "instructions");
    }
  }
  for (const file of textFiles) {
    if (recentPaths.has(file.path)) take(file, "open_recent_files_tokens", "open_recent_files");
  }

  const chatHistoryTokens = Math.max(0, Math.round(model.chatHistoryTokens ?? 0));
  const taskTokens = estimateTokensForText(packetDraft.intent?.task ?? "", tokenizerModel);
  const fileTokens =
    breakdown.changed_files_tokens +
    breakdown.full_specs_tokens +
    breakdown.instructions_tokens +
    breakdown.open_recent_files_tokens;

  return {
    total: fileTokens + chatHistoryTokens + taskTokens,
    breakdown: {
      ...breakdown,
      chat_history_tokens: chatHistoryTokens,
      task_tokens: taskTokens
    },
    counts,
    assumptions: {
      strategy: model.strategy,
      open_recent_files: model.openRecentFiles,
      chat_history_tokens: chatHistoryTokens,
      include_all_specs: model.includeAllSpecs !== false,
      include_all_instructions: model.includeAllInstructions !== false
    }
  };
}

// Retained as an explicitly-labeled upper bound (all directly-useful repo text),
// not a realistic before-state. Kept for comparison and backward compatibility.
function estimateWorkspaceUpperBound(files, charsPerToken = DEFAULT_CHARS_PER_TOKEN) {
  const directlyUsefulKinds = new Set(["doc", "instruction", "source", "spec", "test"]);
  const candidateBytes = files
    .filter((file) => directlyUsefulKinds.has(file.kind) && file.textLike && !file.tooLarge)
    .reduce((total, file) => total + file.size, 0);

  return Math.max(tokensFromBytes(candidateBytes, charsPerToken), 1);
}

async function safeReadPacket(packetPath) {
  try {
    return JSON.parse(await fs.readFile(packetPath, "utf8"));
  } catch {
    return null;
  }
}

function createMetricsEvent(packet) {
  return {
    agent_host: packet.delivery?.target ?? "local-cli",
    baseline_tokens_estimate: packet.metrics.baseline_tokens_estimate,
    baseline_strategy: packet.metrics.baseline_strategy,
    budget_pressure: packet.budget?.pressure ?? "unknown",
    context_reduction_percent: packet.metrics.context_reduction_percent,
    created_at: packet.created_at,
    delivered_tokens_estimate: packet.metrics.delivered_tokens_estimate,
    included_files_count: packet.summary.included_files_count,
    included_spec_units_count: packet.summary.included_spec_units_count,
    included_tests_count: packet.summary.included_tests_count,
    manual_overrides_count: 0,
    packet_id: packet.id,
    packet_tokens_estimate: packet.metrics.packet_tokens_estimate,
    packet_expansions_count: 0,
    wasted_tokens_estimate: packet.metrics.wasted_tokens_estimate ?? packet.metrics.tokens_saved_estimate,
    useful_context_density_percent: packet.metrics.heuristic_useful_context_density_percent,
    redactions_applied_count: packet.security?.redactions_applied ?? 0,
    risk_level: packet.insights?.risk_level ?? "unknown",
    schema_version: METRICS_SCHEMA_VERSION,
    stale_spec_warnings_count: packet.warnings.filter((warning) => warning.type === "stale-spec").length,
    target_model: packet.metrics.target_model ?? "default",
    target_tokens: packet.budget?.target_tokens ?? null,
    timestamp: nowIso(),
    tokens_saved_estimate: packet.metrics.tokens_saved_estimate,
    warnings_count: packet.warnings.length
  };
}

// Groups sessions by a field (e.g. agent_host or target_model) and reports
// per-group sessions, tokens saved, and a token-weighted reduction, so teams
// can see savings broken down by the model or agent that produced them.
function breakdownBy(events, key) {
  const groups = {};
  for (const event of events) {
    const groupKey = event[key] ?? "unknown";
    const group = (groups[groupKey] ??= { sessions: 0, baseline: 0, delivered: 0, tokensSaved: 0 });
    group.sessions += 1;
    group.baseline += event.baseline_tokens_estimate ?? 0;
    group.delivered +=
      event.delivered_tokens_estimate ??
      Math.max(0, (event.baseline_tokens_estimate ?? 0) - (event.tokens_saved_estimate ?? 0));
    group.tokensSaved += event.tokens_saved_estimate ?? 0;
  }
  const result = {};
  for (const [groupKey, totals] of Object.entries(groups)) {
    result[groupKey] = {
      sessions: totals.sessions,
      tokens_saved_estimate: totals.tokensSaved,
      average_context_reduction_percent: Number(percentReduction(totals.baseline, totals.delivered).toFixed(1))
    };
  }
  return result;
}

function summarizeMetrics(events) {
  const totalSessions = events.length;
  const totals = events.reduce(
    (accumulator, event) => {
      accumulator.tokensSaved += event.tokens_saved_estimate ?? 0;
      accumulator.packetTokens += event.packet_tokens_estimate ?? 0;
      accumulator.baselineTokens += event.baseline_tokens_estimate ?? 0;
      // Prefer the delivered-content estimate; fall back to baseline-minus-saved
      // for older events written before the field existed.
      accumulator.deliveredTokens +=
        event.delivered_tokens_estimate ??
        Math.max(0, (event.baseline_tokens_estimate ?? 0) - (event.tokens_saved_estimate ?? 0));
      accumulator.manualOverrides += event.manual_overrides_count ?? 0;
      accumulator.packetExpansions += event.packet_expansions_count ?? 0;
      accumulator.redactions += event.redactions_applied_count ?? 0;
      accumulator.usefulDensity += event.useful_context_density_percent ?? 0;
      accumulator.riskCounts[event.risk_level ?? "unknown"] =
        (accumulator.riskCounts[event.risk_level ?? "unknown"] ?? 0) + 1;
      accumulator.budgetPressureCounts[event.budget_pressure ?? "unknown"] =
        (accumulator.budgetPressureCounts[event.budget_pressure ?? "unknown"] ?? 0) + 1;
      accumulator.staleSpecWarnings += event.stale_spec_warnings_count ?? 0;
      return accumulator;
    },
    {
      baselineTokens: 0,
      budgetPressureCounts: {},
      deliveredTokens: 0,
      manualOverrides: 0,
      packetExpansions: 0,
      packetTokens: 0,
      redactions: 0,
      riskCounts: {},
      staleSpecWarnings: 0,
      tokensSaved: 0,
      usefulDensity: 0
    }
  );

  return {
    // Token-weighted reduction of the context actually delivered to the agent
    // vs. the naive baseline. Using delivered tokens (not the full serialized
    // packet) and weighting by tokens keeps the figure honest across many
    // sessions, including no-change runs.
    average_context_reduction_percent: Number(
      percentReduction(totals.baselineTokens, totals.deliveredTokens).toFixed(1)
    ),
    by_agent_host: breakdownBy(events, "agent_host"),
    by_target_model: breakdownBy(events, "target_model"),
    delivered_tokens_estimate: totals.deliveredTokens,
    average_packet_tokens_estimate:
      totalSessions > 0 ? Math.round(totals.packetTokens / totalSessions) : 0,
    average_useful_context_density_percent:
      totalSessions > 0 ? Number((totals.usefulDensity / totalSessions).toFixed(1)) : 0,
    budget_pressure_counts: totals.budgetPressureCounts,
    packet_expansions: totals.packetExpansions,
    redactions_applied: totals.redactions,
    risk_counts: totals.riskCounts,
    sessions: totalSessions,
    stale_spec_warnings: totals.staleSpecWarnings,
    tokens_saved_estimate: totals.tokensSaved
  };
}

function estimateUsefulContextDensity(packetDraft) {
  const included = [
    ...(packetDraft.changed_artifacts ?? []),
    ...(packetDraft.governing_constraints ?? []),
    ...(packetDraft.impacted_neighbors ?? []),
    ...(packetDraft.supporting_evidence ?? [])
  ];
  if (!included.length) return { percent: 0, usefulItems: 0 };

  const usefulItems = included.filter((item) => {
    const type = item.type ?? item.kind ?? "";
    return (
      ["file_snapshot", "git_diff", "graph_neighbor", "instruction_file", "instruction_section", "spec_section"].includes(type) ||
      item.kind === "test" ||
      item.reason?.toLowerCase().includes("changed")
    );
  }).length;

  return {
    percent: Number(((usefulItems / included.length) * 100).toFixed(1)),
    usefulItems
  };
}

function buildManagerRecommendations(summary) {
  const recommendations = [];
  const highRisk = summary.risk_counts.high ?? 0;
  const overBudget = summary.budget_pressure_counts.over ?? 0;
  const staleSpecs = summary.stale_spec_warnings ?? 0;

  if (summary.sessions === 0) {
    return ["Run Context Delta on a few real tasks to establish a baseline."];
  }
  if (highRisk > 0) {
    recommendations.push("Review high-risk packets for missing specs, tests, or oversized context.");
  }
  if (overBudget > 0) {
    recommendations.push("Tune target token budgets or exclusions for over-budget packets.");
  }
  if (staleSpecs > 0) {
    recommendations.push("Use stale spec warnings to clean up outdated requirements.");
  }
  if ((summary.average_useful_context_density_percent ?? 0) < 40) {
    recommendations.push("Add eval labels or pin controls for low useful-context density tasks.");
  }
  if (summary.redactions_applied > 0) {
    recommendations.push("Check redacted files and confirm secrets are not being sent to agent chats.");
  }
  if (!recommendations.length) {
    recommendations.push("Current packet quality looks healthy; keep monitoring risk and budget mix.");
  }
  return recommendations;
}

function percentOf(value, total) {
  if (!total) return 0;
  return Number(((value / total) * 100).toFixed(1));
}

function renderCounts(counts = {}) {
  const entries = Object.entries(counts);
  if (!entries.length) return "No data.";
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
}
