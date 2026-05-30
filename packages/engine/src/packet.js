import crypto from "node:crypto";
import path from "node:path";
import {
  PACKET_SCHEMA_VERSION,
  createStableId,
  nowIso
} from "../../shared/src/index.js";
import { isPathExcluded, loadConfig } from "./config.js";
import { getGitDiffForPath, getGitState } from "./git.js";
import { buildCompactPacketView, buildPacketInsights } from "./insights.js";
import { buildInstructionWarnings, findApplicableInstructions } from "./instructions.js";
import { findRelevantMarkdownSections } from "./markdown.js";
import { buildPacketMetrics } from "./metrics.js";
import {
  derivePathKeywords,
  explainFileInclusion,
  extractKeywords,
  pickRankedFiles,
  scoreFile
} from "./ranking.js";
import { redactPacket } from "./redaction.js";
import { readFileSnippet, scanWorkspace } from "./scanner.js";
import { buildSpecKitWarnings, detectSpecKit, scopeSpecEvidence } from "./spec-kit.js";
import { findSourceGraphNeighbors } from "./source-graph.js";
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
  const specKit = detectSpecKit(eligibleFiles, {
    branch: git.branch,
    changedPaths,
    task
  });

  const keywords = [
    ...new Set([...extractKeywords(task), ...derivePathKeywords(changedPaths).slice(0, 12)])
  ];

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
    limit: limits.tests
  });

  const rankedImpacted = pickRankedFiles(eligibleFiles, keywords, changedPaths, {
    excludeKinds: ["instruction", "spec", "test"],
    limit: limits.impacted
  }).filter((item) => !changedPaths.has(item.file.path));

  const rankedInstructions = pickRankedFiles(eligibleFiles, keywords, changedPaths, {
    includeKinds: ["instruction"],
    limit: limits.instructions
  });

  const markdownSections = await findRelevantMarkdownSections(eligibleFiles, keywords, {
    limit: limits.markdownSections
  });

  const supportingEvidence = dedupeItems([
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
    ...(await Promise.all(
      rankedTests.map((item) => fileToPacketItem(item.file, changedPaths, keywords, limits))
    ))
  ]).slice(0, limits.markdownSections + limits.tests);

  // Spec Kit scoping: keep the active feature's spec sections, demote the rest.
  const specScope = scopeSpecEvidence(specKit, supportingEvidence);
  const scopedSupportingEvidence = specScope.kept;

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
      rankedInstructions.map((item) => fileToPacketItem(item.file, changedPaths, keywords, limits))
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
        .map((item) => fileToPacketItem(item.file, changedPaths, keywords, limits))
    ))
  ]).slice(0, limits.impacted);

  const changedArtifactPaths = new Set(changedArtifacts.map((item) => item.path));
  const pinnedContext = dedupeItems(await buildPinnedContext(eligibleFiles, config, limits)).filter(
    (item) => !changedArtifactPaths.has(item.path)
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
    ...scopedSupportingEvidence.map((item) => item.path)
  ]);
  const dedupedImpactedNeighbors = impactedNeighbors.filter(
    (item) => !higherPriorityPaths.has(item.path)
  );

  const excluded = [
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
    ...buildSpecKitWarnings(specKit)
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
      target_tokens: limits.targetTokens
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
    spec_kit: {
      detected: specKit.isSpecKit,
      has_specify_dir: specKit.hasSpecify,
      constitution: specKit.constitution,
      active_feature: specKit.activeFeature
        ? { id: specKit.activeFeature.id, dir: specKit.activeFeature.dir, reason: specKit.activeFeature.reason }
        : null,
      features: specKit.features.map((feature) => ({ id: feature.id, active: feature.active }))
    },
    supporting_evidence: [...pinnedContext, ...scopedSupportingEvidence],
    summary: {},
    warnings,
    workspace: {
      git: {
        available: git.available,
        branch: git.branch ?? null,
        changed_paths_count: changedPaths.size,
        strategy: git.available ? "git-status" : snapshot.strategy
      },
      root: workspaceRoot,
      scanned_files_count: scan.files.length
    }
  };

  packetDraft.summary = buildSummary(packetDraft);
  packetDraft.metrics = buildPacketMetrics(packetDraft, scan.files, config.baseline);
  const redacted = redactPacket(packetDraft, config).packet;
  redacted.summary = buildSummary(redacted);
  redacted.metrics = buildPacketMetrics(redacted, scan.files, config.baseline);
  redacted.budget = {
    ...redacted.budget,
    packet_tokens_estimate: redacted.metrics.packet_tokens_estimate,
    pressure: getBudgetPressure(redacted.metrics.packet_tokens_estimate, limits.targetTokens)
  };
  redacted.warnings = [
    ...redacted.warnings,
    ...buildBudgetWarnings(redacted.metrics.packet_tokens_estimate, limits.targetTokens)
  ];
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

async function fileToPacketItem(file, changedPaths, keywords, limits) {
  return {
    content: await readFileSnippet(file, { maxChars: limits.snippetChars }),
    kind: file.kind,
    path: file.path,
    reason: explainFileInclusion(file, changedPaths, keywords),
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
