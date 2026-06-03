import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  PACKET_SCHEMA_VERSION,
  createStableId,
  estimateTokensForText,
  nowIso
} from "../../shared/src/index.js";
import { isPathExcluded, loadConfig } from "./config.js";
import { getGitDiffForPath, getGitState } from "./git.js";
import { buildCompactPacketView, buildPacketInsights } from "./insights.js";
import { buildInstructionWarnings, findApplicableInstructions } from "./instructions.js";
import { findRelevantMarkdownSections, findSpecTraceLinks } from "./markdown.js";
import { buildPacketMetrics } from "./metrics.js";
import {
  derivePathKeywords,
  explainFileInclusion,
  extractKeywords,
  pickRankedFiles,
  scoreFile
} from "./ranking.js";
import { redactPacket } from "./redaction.js";
import { buildRelevanceIndex } from "./relevance.js";
import { readFileSnippet, scanWorkspace } from "./scanner.js";
import { reviewSpecs } from "./spec-freshness.js";
import { buildSpecKitWarnings, detectSpecKit, scopeSpecEvidence } from "./spec-kit.js";
import { findCoveringTests, findSourceGraphNeighbors } from "./source-graph.js";
import { detectSnapshotChanges, writeSnapshot } from "./snapshot.js";

const DEFAULT_LIMITS = {
  changed: 12,
  excluded: 20,
  impacted: 12,
  instructions: 8,
  markdownSections: 10,
  snippetChars: 10_000,
  targetTokens: 12_000,
  tests: 8
};

export async function buildContextPacket(options) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const task = String(options.task ?? "").trim();
  if (!task) {
    throw new Error("A task is required to build a context packet.");
  }

  const inlineConfig = {};
  if (options.mode) inlineConfig.mode = options.mode;
  if (options.model) inlineConfig.targetModel = options.model;
  if (options.limits) inlineConfig.limits = options.limits;
  if (options.exclude?.length || options.pin?.length) {
    inlineConfig.controls = {
      exclude: options.exclude ?? [],
      pin: options.pin ?? []
    };
  }

  const config = await loadConfig(workspaceRoot, {
    configPath: options.configPath,
    inlineConfig
  });
  const limits = { ...DEFAULT_LIMITS, ...config.limits };
  const scan = await scanWorkspace(workspaceRoot, options.scan);
  const policyExcluded = scan.files.filter((file) => isPathExcluded(file.path, config));
  const eligibleFiles = scan.files.filter((file) => !isPathExcluded(file.path, config));
  const git = await getGitState(workspaceRoot);
  const snapshot = git.available
    ? { changedPaths: [], hasSnapshot: false, strategy: "git" }
    : await detectSnapshotChanges(workspaceRoot, eligibleFiles);

  const changedPaths = new Set(
    (git.available ? git.changedPaths : snapshot.changedPaths).filter(
      (changedPath) => !isPathExcluded(changedPath, config)
    )
  );
  // Auto-escalate the token budget by how much actually changed: a 1-file fix
  // and a 15-file refactor legitimately need different budgets, so the pressure
  // signal should track task size instead of flagging large diffs as over budget.
  // Only count a real delta (git status or a snapshot baseline) — on a first run
  // with no baseline the "changes" are only inferred, so we don't escalate.
  const hasRealDelta = git.available || snapshot.hasSnapshot;
  const budgetTier = resolveBudgetTier(limits.targetTokens, hasRealDelta ? changedPaths.size : 0);
  const monorepo = await detectMonorepo(scan.files, workspaceRoot);

  const specKit = detectSpecKit(eligibleFiles, {
    branch: git.branch,
    changedPaths,
    task
  });

  const keywords = [
    ...new Set([...extractKeywords(task), ...derivePathKeywords(changedPaths).slice(0, 12)])
  ];

  // Content + symbol relevance index (local, deterministic). Built once and
  // shared across the ranked selections so relevance reflects what files
  // actually contain and define, not just their paths.
  const relevanceIndex = await buildRelevanceIndex(eligibleFiles, {
    maxChars: limits.snippetChars
  });

  const changedArtifacts = await buildChangedArtifacts(
    workspaceRoot,
    eligibleFiles,
    changedPaths,
    git,
    limits,
    keywords
  );

  const rankedTests = pickRankedFiles(eligibleFiles, keywords, changedPaths, {
    includeKinds: ["test"],
    index: relevanceIndex,
    limit: limits.tests
  });

  // Coverage edges: tests that import the changed files are the tests that
  // actually exercise them. Surface these ahead of keyword-ranked tests with a
  // precise reason, so a "you didn't include my test" complaint can't land.
  const coveringTests = await findCoveringTests(eligibleFiles, changedPaths, {
    snippetChars: limits.snippetChars
  });
  const coveringTestItems = await Promise.all(
    coveringTests.map(async (covering) => {
      const item = await fileToPacketItem(covering.file, changedPaths, keywords, limits, relevanceIndex);
      return {
        ...item,
        coverage_targets: covering.covers,
        reason: covering.reason,
        score: (item.score ?? 0) + covering.score
      };
    })
  );

  const rankedImpacted = pickRankedFiles(eligibleFiles, keywords, changedPaths, {
    excludeKinds: ["instruction", "spec", "test"],
    index: relevanceIndex,
    limit: limits.impacted,
    requireSignal: true
  }).filter((item) => !changedPaths.has(item.file.path));

  const rankedInstructions = pickRankedFiles(eligibleFiles, keywords, changedPaths, {
    includeKinds: ["instruction"],
    index: relevanceIndex,
    limit: limits.instructions
  });

  const markdownSections = await findRelevantMarkdownSections(eligibleFiles, keywords, {
    limit: limits.markdownSections
  });

  // Spec->code traceability: spec sections that explicitly reference the changed
  // files or their symbols, surfaced even when task keywords don't match them.
  const changedSymbols = extractChangedSymbols(changedArtifacts);
  const specTraceLinks = await findSpecTraceLinks(eligibleFiles, changedPaths, changedSymbols, {
    limit: limits.markdownSections
  });

  const supportingEvidence = dedupeItems([
    ...specTraceLinks,
    ...markdownSections
      .filter((section) => section.fileKind !== "instruction")
      .map((section) => ({
        content: section.content,
        heading: section.heading,
        line_start: section.lineStart,
        path: section.path,
        reason: explainMarkdownReason(section),
        score: section.score,
        tokens_estimate: section.tokensEstimate,
        type: section.fileKind === "spec" ? "spec_section" : "doc_section"
      })),
    ...coveringTestItems,
    ...(await Promise.all(
      rankedTests.map((item) => fileToPacketItem(item.file, changedPaths, keywords, limits, relevanceIndex))
    ))
  ]).slice(0, limits.markdownSections + limits.tests);

  // Spec Kit scoping: keep the active feature's spec sections, demote the rest.
  const specScope = scopeSpecEvidence(specKit, supportingEvidence);

  // Spec freshness: a spec section marked deprecated/superseded is a stale
  // requirement — keep it out of the packet (the agent should never plan from
  // it) and report why.
  const candidateSpecPaths = new Set(
    specScope.kept.filter((item) => item.type === "spec_section").map((item) => item.path)
  );
  const specReview = await reviewSpecs(
    eligibleFiles.filter((file) => file.kind === "spec" && candidateSpecPaths.has(file.path)),
    { snippetChars: limits.snippetChars }
  );
  const deprecatedSpecPaths = new Set(specReview.deprecated.map((entry) => entry.path));
  const scopedSupportingEvidence = specScope.kept.filter((item) => !deprecatedSpecPaths.has(item.path));
  const deprecatedSpecExclusions = specReview.deprecated.map((entry) => ({
    kind: "spec",
    path: entry.path,
    reason: `Spec marked ${entry.status}; excluded as a stale requirement.`
  }));

  const relevantPaths = new Set([
    ...changedArtifacts.map((item) => item.path),
    ...rankedTests.map((item) => item.file.path),
    ...rankedImpacted.map((item) => item.file.path),
    ...markdownSections.map((section) => section.path)
  ]);
  const applicableInstructions = await findApplicableInstructions(eligibleFiles, relevantPaths, keywords, {
    limit: limits.instructions,
    snippetChars: limits.snippetChars
  });

  const governingConstraints = dedupeItems([
    ...applicableInstructions,
    ...markdownSections
      .filter((section) => section.fileKind === "instruction")
      .map((section) => ({
        content: section.content,
        heading: section.heading,
        line_start: section.lineStart,
        path: section.path,
        reason: "Instruction file section that may constrain the agent",
        score: section.score,
        tokens_estimate: section.tokensEstimate,
        type: "instruction_section"
      })),
    ...(await Promise.all(
      rankedInstructions.map((item) => fileToPacketItem(item.file, changedPaths, keywords, limits, relevanceIndex))
    ))
  ]).slice(0, limits.instructions);

  const graphNeighbors = await findSourceGraphNeighbors(eligibleFiles, changedPaths, keywords, {
    limit: limits.impacted,
    snippetChars: limits.snippetChars
  });
  const graphNeighborPaths = new Set(graphNeighbors.map((item) => item.path));
  const impactedNeighbors = dedupeItems([
    ...graphNeighbors,
    ...(await Promise.all(
      rankedImpacted
        .filter((item) => !graphNeighborPaths.has(item.file.path))
        .map((item) => fileToPacketItem(item.file, changedPaths, keywords, limits, relevanceIndex))
    ))
  ]).slice(0, limits.impacted);

  const changedArtifactPaths = new Set(changedArtifacts.map((item) => item.path));
  const pinnedContext = dedupeItems(await buildPinnedContext(eligibleFiles, config, limits)).filter(
    (item) => !changedArtifactPaths.has(item.path)
  );

  // A pinned file (e.g. from a pinned directory) must not also be re-delivered as a
  // ranked supporting item such as a nearby test or doc section. Drop ranked
  // evidence whose path is already pinned so its content is not sent twice.
  const pinnedPaths = new Set(pinnedContext.map((item) => item.path));
  const dedupedSupportingEvidence = scopedSupportingEvidence.filter(
    (item) => !pinnedPaths.has(item.path)
  );

  // Cross-bucket dedup: impacted neighbors are the lowest-priority "maybe related"
  // bucket, so drop any path already delivered with content in a primary bucket
  // (changed, governing constraints, pinned, or supporting evidence). Without this,
  // a file like a pinned stylesheet is sent to the agent twice and inflates the
  // delivered-token estimate.
  const higherPriorityPaths = new Set([
    ...changedArtifacts.map((item) => item.path),
    ...governingConstraints.map((item) => item.path),
    ...pinnedContext.map((item) => item.path),
    ...dedupedSupportingEvidence.map((item) => item.path)
  ]);
  const dedupedImpactedNeighbors = impactedNeighbors.filter(
    (item) => !higherPriorityPaths.has(item.path)
  );

  const excluded = [
    ...deprecatedSpecExclusions,
    ...policyExcluded.map((file) => ({
      kind: file.kind,
      path: file.path,
      reason: "Excluded by Context Delta policy or user control"
    })),
    ...buildExcludedItems(eligibleFiles, {
      changedPaths,
      includedPaths: new Set([
        ...changedArtifacts.map((item) => item.path),
        ...dedupedImpactedNeighbors.map((item) => item.path),
        ...governingConstraints.map((item) => item.path),
        ...pinnedContext.map((item) => item.path),
        ...scopedSupportingEvidence.map((item) => item.path)
      ]),
      limit: limits.excluded
    }),
    ...specScope.demoted
  ].slice(0, limits.excluded + policyExcluded.length + specScope.demoted.length);

  const warnings = [
    ...buildWarnings({ config, git, scan, snapshot, supportingEvidence: scopedSupportingEvidence }),
    ...buildInstructionWarnings(governingConstraints),
    ...buildSpecKitWarnings(specKit),
    ...specReview.deprecated.map((entry) => ({
      message: `Spec ${entry.path} is marked ${entry.status}; kept out of the packet as a stale requirement.`,
      type: "stale-spec"
    }))
  ];

  const packetDraft = {
    changed_artifacts: changedArtifacts,
    controls: {
      excluded: config.controls.exclude,
      mode: config.mode,
      pinned: config.controls.pin
    },
    created_at: nowIso(),
    budget: {
      mode: config.mode,
      tier: budgetTier.tier,
      auto_escalated: budgetTier.autoEscalated,
      target_tokens: budgetTier.targetTokens
    },
    delivery: {
      target: options.target ?? "local-cli"
    },
    excluded,
    governing_constraints: governingConstraints,
    impacted_neighbors: dedupedImpactedNeighbors,
    intent: {
      confidence: estimateIntentConfidence({
        changedArtifacts,
        keywords,
        supportingEvidence: scopedSupportingEvidence
      }),
      keywords,
      task
    },
    schema_version: PACKET_SCHEMA_VERSION,
    spec_review: {
      deprecated_specs: specReview.deprecated
    },
    spec_kit: {
      detected: specKit.isSpecKit,
      has_specify_dir: specKit.hasSpecify,
      constitution: specKit.constitution,
      active_feature: specKit.activeFeature
        ? { id: specKit.activeFeature.id, dir: specKit.activeFeature.dir, reason: specKit.activeFeature.reason }
        : null,
      features: specKit.features.map((feature) => ({ id: feature.id, active: feature.active }))
    },
    supporting_evidence: [...pinnedContext, ...dedupedSupportingEvidence],
    summary: {},
    warnings,
    workspace: {
      git: {
        available: git.available,
        branch: git.branch ?? null,
        changed_paths_count: changedPaths.size,
        strategy: git.available ? "git-status" : snapshot.strategy
      },
      monorepo,
      root: workspaceRoot,
      scanned_files_count: scan.files.length
    }
  };

  packetDraft.summary = buildSummary(packetDraft);
  packetDraft.metrics = buildPacketMetrics(packetDraft, scan.files, config.baseline, config.targetModel);
  const redacted = redactPacket(packetDraft, config).packet;
  redacted.summary = buildSummary(redacted);
  redacted.metrics = buildPacketMetrics(redacted, scan.files, config.baseline, config.targetModel);
  redacted.budget = {
    ...redacted.budget,
    allocation: buildBudgetAllocation(redacted),
    packet_tokens_estimate: redacted.metrics.packet_tokens_estimate,
    pressure: getBudgetPressure(redacted.metrics.packet_tokens_estimate, budgetTier.targetTokens)
  };
  redacted.warnings = [
    ...redacted.warnings,
    ...buildBudgetWarnings(redacted.metrics.packet_tokens_estimate, budgetTier.targetTokens)
  ];
  // Governance: an auditable record of what policy enforced on this packet —
  // policy exclusions, secret redactions, deprecated specs kept out, and whether
  // the delivered context stayed within any configured hard ceiling.
  redacted.compliance = buildCompliance({
    config,
    deprecatedSpecs: specReview.deprecated,
    deliveredTokens: redacted.metrics.delivered_tokens_estimate,
    policyExcludedCount: policyExcluded.length,
    redactionsApplied: redacted.security?.redactions_applied ?? 0
  });
  redacted.warnings = [...redacted.warnings, ...redacted.compliance.violations.map((message) => ({ message, type: "policy-violation" }))];
  redacted.summary = buildSummary(redacted);
  redacted.id = createPacketId(redacted);
  redacted.insights = buildPacketInsights(redacted);
  redacted.compact_view = buildCompactPacketView(redacted);

  if (options.updateSnapshot !== false) {
    await writeSnapshot(workspaceRoot, eligibleFiles);
  }

  return {
    packet: redacted,
    scan
  };
}

export function getUniqueIncludedItems(packet) {
  return dedupeItems([
    ...packet.changed_artifacts,
    ...packet.supporting_evidence,
    ...packet.governing_constraints,
    ...packet.impacted_neighbors
  ]);
}

async function buildChangedArtifacts(workspaceRoot, files, changedPaths, git, limits, keywords = []) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const artifacts = [];

  const orderedChangedPaths = [...changedPaths].sort((left, right) => {
    const leftFile = byPath.get(left);
    const rightFile = byPath.get(right);
    const leftScore = leftFile ? scoreFile(leftFile, keywords, changedPaths) : 0;
    const rightScore = rightFile ? scoreFile(rightFile, keywords, changedPaths) : 0;
    if (rightScore !== leftScore) return rightScore - leftScore;
    return left.localeCompare(right);
  });

  for (const changedPath of orderedChangedPaths.slice(0, limits.changed)) {
    const file = byPath.get(changedPath);
    if (!file) {
      artifacts.push({
        path: changedPath,
        reason: "Changed path no longer exists locally",
        type: "deleted_or_missing"
      });
      continue;
    }

    const diff = git.available ? await getGitDiffForPath(workspaceRoot, file.path) : "";
    artifacts.push({
      content: diff || (await readFileSnippet(file, { maxChars: limits.snippetChars })),
      kind: file.kind,
      path: file.path,
      reason: git.available
        ? "Changed according to git status"
        : "Changed according to local snapshot detection",
      type: diff ? "git_diff" : "file_snapshot"
    });
  }

  return artifacts;
}

// Pulls declared identifiers (functions, classes, types, Python/Go defs) out of
// the changed files so spec sections that reference those symbols can be traced.
function extractChangedSymbols(changedArtifacts) {
  const symbolRe =
    /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|def|func)\s+([A-Za-z_$][\w$]*)/g;
  const symbols = new Set();
  for (const item of changedArtifacts ?? []) {
    const content = typeof item.content === "string" ? item.content : "";
    for (const match of content.matchAll(symbolRe)) {
      if (match[1] && match[1].length >= 4) symbols.add(match[1]);
    }
  }
  return [...symbols].slice(0, 40);
}

async function fileToPacketItem(file, changedPaths, keywords, limits, index = null) {
  return {
    content: await readFileSnippet(file, { maxChars: limits.snippetChars }),
    kind: file.kind,
    path: file.path,
    reason: explainFileInclusion(file, changedPaths, keywords, index),
    type: file.kind
  };
}

async function buildPinnedContext(files, config, limits) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const pinned = [];
  // Cap how many files a single pinned directory expands to, so pinning a large
  // folder (e.g. "packages") cannot silently blow the token budget.
  const pinnedDirLimit = limits.pinnedDirFiles ?? 12;

  for (const pinnedPath of config.controls.pin ?? []) {
    const file = byPath.get(pinnedPath);
    if (file) {
      pinned.push({
        content: await readFileSnippet(file, { maxChars: limits.snippetChars }),
        kind: file.kind,
        path: file.path,
        reason: "Pinned by user control",
        type: "pinned"
      });
      continue;
    }

    // Directory / prefix pin: agents (and people) naturally pin folders like
    // "docs/site" or "packages". Expand the pin to the text-like files under it,
    // sorted for stable output and capped to protect the budget.
    const prefix = pinnedPath.endsWith("/") ? pinnedPath : `${pinnedPath}/`;
    const underDirectory = files
      .filter((candidate) => candidate.textLike && candidate.path.startsWith(prefix))
      .sort((left, right) => left.path.localeCompare(right.path));

    if (underDirectory.length > 0) {
      const selected = underDirectory.slice(0, pinnedDirLimit);
      for (const dirFile of selected) {
        pinned.push({
          content: await readFileSnippet(dirFile, { maxChars: limits.snippetChars }),
          kind: dirFile.kind,
          path: dirFile.path,
          reason:
            underDirectory.length > selected.length
              ? `Pinned by user control (from pinned directory ${pinnedPath}; ${selected.length} of ${underDirectory.length} files)`
              : `Pinned by user control (from pinned directory ${pinnedPath})`,
          type: "pinned"
        });
      }
      continue;
    }

    pinned.push({
      path: pinnedPath,
      reason: "Pinned by user, but no matching file or directory was found in the workspace",
      type: "missing_pinned"
    });
  }

  return pinned;
}

function buildExcludedItems(files, { changedPaths, includedPaths, limit }) {
  return files
    .filter((file) => file.textLike)
    .filter((file) => !includedPaths.has(file.path))
    .filter((file) => !changedPaths.has(file.path))
    .slice(0, limit)
    .map((file) => ({
      kind: file.kind,
      path: file.path,
      reason: file.tooLarge
        ? "Excluded because it is too large for the initial packet"
        : "Not ranked high enough for this task packet"
    }));
}

function dedupeItems(items) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const key = [
      item.type ?? item.kind ?? "item",
      item.path ?? "unknown",
      item.heading ?? item.line_start ?? ""
    ].join(":");

    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function buildWarnings({ config, git, scan, snapshot, supportingEvidence }) {
  const warnings = [];

  if (!git.available) {
    warnings.push({
      message: "Git was not available; Context Delta used local snapshot signals.",
      type: "no-git"
    });
  }

  if (!git.available && !snapshot.hasSnapshot) {
    warnings.push({
      message: "No previous snapshot existed; recent text files were used as first-run signals.",
      type: "first-run-snapshot"
    });
  }

  const specCount = scan.files.filter((file) => file.kind === "spec").length;
  const includedSpecCount = supportingEvidence.filter((item) => item.type === "spec_section").length;
  if (specCount > 0 && includedSpecCount === 0) {
    warnings.push({
      message: "Specs were detected, but no spec section strongly matched this task.",
      type: "stale-spec"
    });
  }

  if (config.mode === "strict") {
    warnings.push({
      message: "Strict mode is active; packets are smaller and policy exclusions are applied first.",
      type: "strict-mode"
    });
  }

  return warnings;
}

function buildBudgetWarnings(packetTokensEstimate, targetTokens) {
  if (!targetTokens || packetTokensEstimate <= targetTokens) return [];
  return [
    {
      message: `Packet estimate ${packetTokensEstimate} tokens exceeds target ${targetTokens}. Consider strict mode or exclusions.`,
      type: "budget-over-target"
    }
  ];
}

// Raises the budget ceiling with change volume so a large, legitimate diff is
// not flagged as over budget. Tiers mirror common presets; the configured
// target is treated as a floor, never lowered.
// Builds the governance/compliance record for the packet: what policy enforced,
// and whether the delivered context honored any configured hard limits. Makes
// the packet an audit artifact — the governance angle for teams and enterprises.
function buildCompliance({ config, deprecatedSpecs, deliveredTokens, policyExcludedCount, redactionsApplied }) {
  const maxDeliveredTokens = config.policy?.maxDeliveredTokens ?? null;
  const withinTokenCeiling =
    !Number.isFinite(maxDeliveredTokens) || maxDeliveredTokens <= 0 ? true : deliveredTokens <= maxDeliveredTokens;
  const violations = [];
  if (!withinTokenCeiling) {
    violations.push(
      `Delivered ${deliveredTokens} tokens exceeds policy ceiling of ${maxDeliveredTokens}; tighten exclusions or raise the ceiling.`
    );
  }
  return {
    delivered_tokens: deliveredTokens,
    deprecated_specs_excluded: deprecatedSpecs.length,
    max_delivered_tokens: maxDeliveredTokens,
    policy_excluded_count: policyExcludedCount,
    redact_secrets: config.policy?.redactSecrets !== false,
    redactions_applied: redactionsApplied,
    violations,
    within_token_ceiling: withinTokenCeiling
  };
}

// Detects common monorepo layouts so the packet can report the workspace shape.
// Lightweight metadata for now (used by surfaces and future per-package scoping).
async function detectMonorepo(files, root) {
  const has = (name) => files.some((file) => file.path === name);
  let tool = null;
  if (has("pnpm-workspace.yaml")) tool = "pnpm";
  else if (has("nx.json")) tool = "nx";
  else if (has("turbo.json")) tool = "turbo";
  else if (has("lerna.json")) tool = "lerna";

  let packages = [];
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
    if (workspaces.length) {
      packages = workspaces;
      if (!tool) tool = "npm-workspaces";
    }
  } catch {
    // No root package.json or unparseable — not an npm workspace.
  }

  return { detected: Boolean(tool), packages: packages.slice(0, 20), tool: tool ?? null };
}

function resolveBudgetTier(baseTarget, changedCount) {
  const base = baseTarget ?? 12_000;
  if (changedCount >= 10) {
    return { autoEscalated: base < 16_000, targetTokens: Math.max(base, 16_000), tier: "thorough" };
  }
  if (changedCount >= 5) {
    return { autoEscalated: base < 12_000, targetTokens: Math.max(base, 12_000), tier: "balanced" };
  }
  return { autoEscalated: false, targetTokens: base, tier: "focused" };
}

// Honest, per-packet token allocation across sections — where the delivered
// budget actually went. More transparent than fixed budget slots.
function buildBudgetAllocation(packet) {
  const tokensOf = (item) =>
    Number.isFinite(item.tokens_estimate)
      ? item.tokens_estimate
      : estimateTokensForText(typeof item.content === "string" ? item.content : "");
  const sum = (items) => (items ?? []).reduce((total, item) => total + tokensOf(item), 0);
  return {
    changed: sum(packet.changed_artifacts),
    constraints: sum(packet.governing_constraints),
    evidence: sum(packet.supporting_evidence),
    neighbors: sum(packet.impacted_neighbors)
  };
}

function getBudgetPressure(packetTokensEstimate, targetTokens) {
  if (!targetTokens || targetTokens <= 0) return "unknown";
  const ratio = packetTokensEstimate / targetTokens;
  if (ratio <= 0.65) return "low";
  if (ratio <= 0.95) return "medium";
  if (ratio <= 1.15) return "high";
  return "over";
}

function buildSummary(packet) {
  const includedPaths = new Set();
  for (const bucket of [
    packet.changed_artifacts,
    packet.governing_constraints,
    packet.impacted_neighbors,
    packet.supporting_evidence
  ]) {
    for (const item of bucket) {
      if (item.path) includedPaths.add(item.path);
    }
  }

  return {
    changed_files_count: packet.changed_artifacts.length,
    excluded_files_count: packet.excluded.length,
    included_files_count: includedPaths.size,
    included_spec_units_count: packet.supporting_evidence.filter(
      (item) => item.type === "spec_section"
    ).length,
    included_tests_count: packet.supporting_evidence.filter((item) => item.kind === "test").length,
    warnings_count: packet.warnings.length
  };
}

function estimateIntentConfidence({ changedArtifacts, keywords, supportingEvidence }) {
  let score = 0.45;
  if (keywords.length >= 2) score += 0.1;
  if (changedArtifacts.length > 0) score += 0.15;
  if (supportingEvidence.some((item) => item.type === "spec_section")) score += 0.15;
  if (supportingEvidence.some((item) => item.kind === "test")) score += 0.1;
  return Number(Math.min(0.95, score).toFixed(2));
}

function explainMarkdownReason(section) {
  if (section.fileKind === "spec") return "Spec section matched the task and may define intent";
  return "Documentation section matched the task and may provide supporting context";
}

function createPacketId(packet) {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify({
      created_at: packet.created_at,
      task: packet.intent.task,
      workspace: packet.workspace.root
    }))
    .digest("hex")
    .slice(0, 10);

  return createStableId(["packet", hash]);
}
