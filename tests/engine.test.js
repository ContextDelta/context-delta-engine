import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompactPacketView,
  buildContextPacket,
  buildPacketInsights,
  buildPacketDiff,
  buildIncrementalHandoffModel,
  cleanupStaleControls,
  getSetupStatus,
  getUniqueIncludedItems,
  listPacketHistory,
  readMetricsSummary,
  readPreviousPacket,
  renderContextDriftMarkdown,
  renderReplayPrompt,
  renderHandoff,
  renderRiskHeader,
  renderSetupMarkdown,
  reviewContextDrift,
  runPacketEval,
  detectSpecKit,
  scanWorkspace,
  syncInstructionFiles,
  upsertManagedBlock,
  renderInstructionDigest,
  MANAGED_BEGIN,
  MANAGED_END,
  writePacketApproval,
  writeDefaultConfig,
  writeHtmlReport,
  writeManagerSummary,
  writePacketAndMetrics,
  writeSnapshot
} from "../packages/engine/src/index.js";

import { estimateTokensForText, getTokenizerInfo, resolveEncoding } from "../packages/shared/src/index.js";
import { scoreFile, hasRelevanceSignal } from "../packages/engine/src/ranking.js";
import { buildRelevanceIndex, tokenizeIdentifier } from "../packages/engine/src/relevance.js";
import { buildInstructionWarnings } from "../packages/engine/src/instructions.js";
import { findSourceGraphNeighbors } from "../packages/engine/src/source-graph.js";
import { classifyFile } from "../packages/engine/src/file-kinds.js";

const execFileAsync = promisify(execFile);

test("token estimation reports a method and counts content positively", () => {
  const info = getTokenizerInfo();
  assert.ok(["exact_tokenizer", "heuristic"].includes(info.method));
  assert.equal(estimateTokensForText(""), 0);
  assert.equal(estimateTokensForText(null), 0);
  const count = estimateTokensForText("function addNumbers(a, b) { return a + b; }");
  assert.ok(Number.isInteger(count) && count > 0);
  // Deterministic / cache-stable.
  assert.equal(count, estimateTokensForText("function addNumbers(a, b) { return a + b; }"));
});

test("resolveEncoding maps models to encodings with a modern default", () => {
  assert.equal(resolveEncoding(undefined), "o200k_base");
  assert.equal(resolveEncoding("gpt-4o"), "o200k_base");
  assert.equal(resolveEncoding("gpt-5.1"), "o200k_base");
  assert.equal(resolveEncoding("o1-preview"), "o200k_base");
  assert.equal(resolveEncoding("claude-3-5-sonnet"), "o200k_base");
  assert.equal(resolveEncoding("gpt-4"), "cl100k_base");
  assert.equal(resolveEncoding("gpt-3.5-turbo"), "cl100k_base");
});

test("a target model selects the matching tokenizer encoding", async () => {
  const workspace = await createFixtureWorkspace();
  const task = "Add refresh token rotation for admin users";

  const fallback = await buildContextPacket({ task, updateSnapshot: false, workspaceRoot: workspace });
  assert.equal(fallback.packet.metrics.tokenizer_encoding, "o200k_base");
  assert.equal(fallback.packet.metrics.target_model, "default");

  const classic = await buildContextPacket({ task, model: "gpt-4", updateSnapshot: false, workspaceRoot: workspace });
  assert.equal(classic.packet.metrics.tokenizer_encoding, "cl100k_base");
  assert.equal(classic.packet.metrics.target_model, "gpt-4");

  const future = await buildContextPacket({ task, model: "gpt-5.1", updateSnapshot: false, workspaceRoot: workspace });
  assert.equal(future.packet.metrics.tokenizer_encoding, "o200k_base");
  assert.equal(future.packet.metrics.target_model, "gpt-5.1");
});

test("metrics report a transparent, monotonic baseline spectrum", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  const baselines = packet.metrics.baselines;

  assert.ok(baselines.open_files_only && baselines.naive_agent && baselines.whole_repo);
  // The spectrum must be monotonic: floor <= typical <= ceiling.
  assert.ok(baselines.open_files_only.tokens_estimate <= baselines.naive_agent.tokens_estimate);
  assert.ok(baselines.naive_agent.tokens_estimate <= baselines.whole_repo.tokens_estimate);
  // Each baseline carries a human-readable assumption and a reduction figure.
  for (const baseline of Object.values(baselines)) {
    assert.equal(typeof baseline.note, "string");
    assert.ok(baseline.reduction_percent >= 0 && baseline.reduction_percent <= 100);
  }
  // The headline reduction matches the naive-agent baseline.
  assert.equal(packet.metrics.context_reduction_percent, baselines.naive_agent.reduction_percent);
});

test("packet metrics expose the token-count method and a calibrated ratio", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  const m = packet.metrics;

  assert.ok(["exact_tokenizer", "heuristic"].includes(m.token_count_method));
  assert.equal(typeof m.tokenizer_model, "string");
  // Calibration stays in the clamped sane range.
  assert.ok(m.chars_per_token_estimate >= 2.5 && m.chars_per_token_estimate <= 6);
  // Delivered and baseline remain consistent after the tokenizer change.
  assert.ok(m.baseline_tokens_estimate >= m.delivered_tokens_estimate);
  assert.ok(m.tokens_saved_estimate >= 0);
});

test("scanner classifies specs, instructions, tests, and source files", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(workspace, "docs/index.html", "<main>Context Delta</main>\n");
  await writeFile(workspace, "docs/site/styles.css", ".hero { display: grid; }\n");
  await writeFile(workspace, "docs/site/assets/preview.svg", "<svg></svg>\n");
  const scan = await scanWorkspace(workspace);
  const byPath = new Map(scan.files.map((file) => [file.path, file.kind]));

  assert.equal(byPath.get("specs/004-admin-auth/spec.md"), "spec");
  assert.equal(byPath.get(".github/copilot-instructions.md"), "instruction");
  assert.equal(byPath.get("tests/auth/admin-refresh.test.ts"), "test");
  assert.equal(byPath.get("src/auth/service.ts"), "source");
  assert.equal(byPath.get("docs/index.html"), "source");
  assert.equal(byPath.get("docs/site/styles.css"), "source");
  assert.equal(byPath.get("docs/site/assets/preview.svg"), "source");
  assert.ok(scan.files.find((file) => file.path === "docs/index.html")?.textLike);
});

test("scanner records ignored binary and oversized files", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(workspace, "assets/logo.png", Buffer.from([0, 1, 2, 3]));
  const scan = await scanWorkspace(workspace, { maxFileBytes: 30 });

  assert.ok(scan.ignored.some((item) => item.path === "assets/logo.png" && item.reason === "not text-like"));
  assert.ok(scan.ignored.some((item) => item.path === "src/auth/service.ts" && item.reason.includes("larger than")));
});

test("buildContextPacket creates a focused no-git packet", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  assert.equal(packet.schema_version, "0.1");
  assert.equal(packet.workspace.git.available, false);
  assert.ok(packet.intent.keywords.includes("refresh"));
  assert.ok(packet.summary.included_spec_units_count >= 1);
  assert.ok(packet.summary.included_tests_count >= 1);
  assert.ok(packet.governing_constraints.length >= 1);
  assert.ok(packet.metrics.packet_tokens_estimate > 0);
  assert.ok(packet.metrics.delivered_tokens_estimate >= 0);
  assert.ok(packet.metrics.baseline_tokens_estimate >= packet.metrics.delivered_tokens_estimate);
  assert.equal(packet.metrics.baseline_strategy, "naive_agent_context_model");
});

test("upsertManagedBlock preserves user content and is idempotent", () => {
  const digest = "## Active task context\n\n- Task: demo";
  const userContent = "# My Rules\n\nAlways use tabs.\n";
  const first = upsertManagedBlock(userContent, digest);
  assert.ok(first.includes("# My Rules"));
  assert.ok(first.includes("Always use tabs."));
  assert.ok(first.includes(MANAGED_BEGIN));
  assert.ok(first.includes(MANAGED_END));

  // Re-applying the same digest yields an identical file (no churn).
  const second = upsertManagedBlock(first, digest);
  assert.equal(second, first);

  // A new digest replaces only the managed region, leaving user content intact.
  const updated = upsertManagedBlock(first, "## Active task context\n\n- Task: changed");
  assert.ok(updated.includes("# My Rules"));
  assert.ok(updated.includes("Task: changed"));
  assert.ok(!updated.includes("Task: demo"));
  assert.equal(updated.indexOf(MANAGED_BEGIN), updated.lastIndexOf(MANAGED_BEGIN));
});

test("syncInstructionFiles writes scoped digests into agent instruction files", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(workspace, ".github/copilot-instructions.md", "# Project\n\nUse strict mode.\n");
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  const config = { inject: { enabled: true, targets: [".github/copilot-instructions.md", "AGENTS.md"] } };
  const result = await syncInstructionFiles(workspace, packet, config);
  assert.equal(result.enabled, true);
  assert.equal(result.results.length, 2);

  const copilotPath = path.join(workspace, ".github/copilot-instructions.md");
  const agentsPath = path.join(workspace, "AGENTS.md");
  const copilot = await fs.readFile(copilotPath, "utf8");
  const agents = await fs.readFile(agentsPath, "utf8");
  assert.ok(copilot.includes("Use strict mode."));
  assert.ok(copilot.includes("Active task context"));
  assert.ok(copilot.includes(MANAGED_BEGIN));
  assert.ok(agents.includes("Active task context"));

  // Second sync with the same packet does not change the files.
  const again = await syncInstructionFiles(workspace, packet, config);
  assert.ok(again.results.every((entry) => entry.changed === false));

  // Disabled config is a no-op.
  const disabled = await syncInstructionFiles(workspace, packet, { inject: { enabled: false } });
  assert.equal(disabled.enabled, false);
});

test("detectSpecKit picks the active feature and scopes other features out", async () => {
  const files = [
    { path: "specs/003-old-feature/spec.md", kind: "spec", mtimeMs: 1000 },
    { path: "specs/004-admin-auth/spec.md", kind: "spec", mtimeMs: 2000 },
    { path: "specs/004-admin-auth/tasks.md", kind: "spec", mtimeMs: 2000 },
    { path: ".specify/memory/constitution.md", kind: "spec", mtimeMs: 500 }
  ];

  const byBranch = detectSpecKit(files, { branch: "004-admin-auth", changedPaths: new Set() });
  assert.equal(byBranch.isSpecKit, true);
  assert.equal(byBranch.activeFeature.id, "004-admin-auth");
  assert.ok(byBranch.constitution.includes("constitution.md"));
  assert.equal(byBranch.features.filter((feature) => feature.active).length, 1);

  // No branch hint: fall back to the most recently modified feature.
  const byRecency = detectSpecKit(files, { branch: "main", changedPaths: new Set() });
  assert.equal(byRecency.activeFeature.id, "004-admin-auth");
});

test("packet treats non-active Spec Kit feature specs as out of scope", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(
    workspace,
    "specs/002-legacy-billing/spec.md",
    "# Legacy Billing\n\n## Invoices\n\nLegacy billing invoice rules that should not leak into admin auth work.\n"
  );
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users in 004-admin-auth",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  assert.equal(packet.spec_kit.detected, true);
  assert.ok(packet.spec_kit.active_feature);
  const activeId = packet.spec_kit.active_feature.id;
  const leakedOtherFeature = packet.supporting_evidence.some(
    (item) =>
      (item.type === "spec_section" || item.kind === "spec") &&
      /specs\/[0-9]+/.test(item.path ?? "") &&
      !String(item.path).includes(activeId)
  );
  assert.equal(leakedOtherFeature, false);
});

test("renderInstructionDigest is deterministic for the same packet", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  assert.equal(renderInstructionDigest(packet), renderInstructionDigest(packet));
});

test("packet includes insights and a compact preview", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  assert.ok(packet.insights.headline.includes("Packet"));
  assert.ok(["low", "medium", "high"].includes(packet.insights.risk_level));
  assert.ok(packet.insights.cards.some((card) => card.type === "spec"));
  assert.ok(packet.compact_view.included.every((item) => !("content" in item)));

  const rebuiltInsights = buildPacketInsights(packet);
  const rebuiltCompact = buildCompactPacketView(packet);
  assert.equal(rebuiltInsights.risk_level, packet.insights.risk_level);
  assert.equal(rebuiltCompact.id, packet.id);
});

test("packet applies closest instruction files and source graph neighbors", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(
    workspace,
    "src/AGENTS.md",
    "# Source Instructions\n\nAlways keep source changes small and review auth boundaries.\n"
  );
  await writeFile(
    workspace,
    "src/auth/AGENTS.md",
    "# Auth Instructions\n\nNever log refresh tokens in auth code.\n"
  );
  await writeFile(
    workspace,
    "src/auth/controller.ts",
    'import { refreshToken } from "./service";\n\nexport function refreshController(user) {\n  return refreshToken(user);\n}\n'
  );

  const scan = await scanWorkspace(workspace);
  await writeSnapshot(workspace, scan.files);
  await fs.appendFile(path.join(workspace, "src/auth/service.ts"), "\nexport const rotated = true;\n");

  const { packet } = await buildContextPacket({
    task: "Update admin refresh token rotation",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  assert.ok(
    packet.governing_constraints.some(
      (item) => item.path === "src/auth/AGENTS.md" && item.type === "instruction_file"
    )
  );
  assert.ok(packet.warnings.some((warning) => warning.type === "instruction-precedence"));
  assert.ok(
    packet.impacted_neighbors.some(
      (item) => item.path === "src/auth/controller.ts" && item.type === "graph_neighbor"
    )
  );
});

test("source graph follows transitive (multi-hop) impact with distance decay", async () => {
  const workspace = await createFixtureWorkspace();
  // Import chain across separate directories so same-directory scoring does not
  // mask the transitive signal: top -> mid -> leaf.
  await writeFile(workspace, "src/leaf/leaf.ts", "export const leaf = 1;\n");
  await writeFile(workspace, "src/mid/mid.ts", 'import { leaf } from "../leaf/leaf";\nexport const mid = leaf + 1;\n');
  await writeFile(workspace, "src/top/top.ts", 'import { mid } from "../mid/mid";\nexport const top = mid + 1;\n');

  const scan = await scanWorkspace(workspace);
  await writeSnapshot(workspace, scan.files);
  await fs.appendFile(path.join(workspace, "src/leaf/leaf.ts"), "\nexport const leafTwo = 2;\n");

  const { packet } = await buildContextPacket({
    task: "Update the leaf module value",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  const mid = packet.impacted_neighbors.find((item) => item.path === "src/mid/mid.ts");
  const top = packet.impacted_neighbors.find((item) => item.path === "src/top/top.ts");

  // Direct importer is 1 hop; the importer-of-the-importer is reached at 2 hops.
  assert.ok(mid && mid.graph_distance === 1, "direct dependent should be 1 hop");
  assert.ok(top && top.graph_distance === 2, "transitive dependent should be 2 hops");
  // Decay: the closer file outranks the farther one.
  assert.ok(mid.score > top.score, "closer impact should score higher than indirect impact");
});

test("snapshot detection finds changed files without git", async () => {
  const workspace = await createFixtureWorkspace();
  const initialScan = await scanWorkspace(workspace);
  await writeSnapshot(workspace, initialScan.files);
  await fs.appendFile(path.join(workspace, "src/auth/service.ts"), "\nexport const rotated = true;\n");

  const { packet } = await buildContextPacket({
    task: "Update admin refresh token rotation",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  assert.equal(packet.workspace.git.strategy, "local-snapshot");
  assert.ok(packet.changed_artifacts.some((item) => item.path === "src/auth/service.ts"));
});

test("git delta reports deleted files as missing artifacts", async () => {
  const workspace = await createFixtureWorkspace();
  await execFileAsync("git", ["-C", workspace, "init"]);
  await execFileAsync("git", ["-C", workspace, "add", "."]);
  await execFileAsync("git", [
    "-C",
    workspace,
    "-c",
    "user.name=Context Delta Test",
    "-c",
    "user.email=context-delta@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "initial fixture"
  ]);
  await fs.unlink(path.join(workspace, "src/auth/token-store.ts"));

  const { packet } = await buildContextPacket({
    task: "Update admin refresh token rotation",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  assert.equal(packet.workspace.git.available, true);
  assert.ok(
    packet.changed_artifacts.some(
      (item) => item.path === "src/auth/token-store.ts" && item.type === "deleted_or_missing"
    )
  );
});

test("page review tasks prioritize untracked HTML CSS and JS changes", async () => {
  const workspace = await createFixtureWorkspace();
  await execFileAsync("git", ["-C", workspace, "init"]);
  await execFileAsync("git", ["-C", workspace, "add", "."]);
  await execFileAsync("git", [
    "-C",
    workspace,
    "-c",
    "user.name=Context Delta Test",
    "-c",
    "user.email=context-delta@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "initial fixture"
  ]);

  await writeFile(workspace, "docs/index.html", "<main class=\"hero\">Context Delta</main>\n");
  await writeFile(workspace, "docs/site/styles.css", ".hero { min-height: 70vh; }\n");
  await writeFile(workspace, "docs/site/site.js", "window.__contextDelta = true;\n");
  await writeFile(workspace, "docs/random-product-note.md", "# Random note\n");
  await fs.appendFile(path.join(workspace, "README.md"), "\nExtra docs note.\n").catch(async () => {
    await writeFile(workspace, "README.md", "# Demo\n");
  });

  const { packet } = await buildContextPacket({
    limits: {
      changed: 3
    },
    task: "Review the GitHub Pages visual polish changes for responsive layout issues.",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  const changedPaths = packet.changed_artifacts.map((item) => item.path);

  assert.deepEqual(new Set(changedPaths), new Set([
    "docs/index.html",
    "docs/site/site.js",
    "docs/site/styles.css"
  ]));
  assert.ok(packet.changed_artifacts.every((item) => item.content.trim().length > 0));
});

test("packet controls can pin and exclude files", async () => {
  const workspace = await createFixtureWorkspace();
  const scan = await scanWorkspace(workspace);
  await writeSnapshot(workspace, scan.files);

  const pinned = await buildContextPacket({
    pin: ["docs/legacy-oauth.md"],
    task: "Update admin refresh token rotation",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  assert.ok(
    pinned.packet.supporting_evidence.some(
      (item) => item.path === "docs/legacy-oauth.md" && item.type === "pinned"
    )
  );

  const excluded = await buildContextPacket({
    exclude: ["docs/legacy-oauth.md"],
    task: "Update admin refresh token rotation",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  assert.ok(excluded.packet.excluded.some((item) => item.path === "docs/legacy-oauth.md"));
  assert.ok(
    !excluded.packet.supporting_evidence.some((item) => item.path === "docs/legacy-oauth.md")
  );
});

test("packet includes budget pressure warning when target is exceeded", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    limits: {
      targetTokens: 10
    },
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  assert.equal(packet.budget.pressure, "over");
  assert.ok(packet.warnings.some((warning) => warning.type === "budget-over-target"));
});

test("unique included item view removes exact duplicates", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  packet.supporting_evidence.push(packet.supporting_evidence[0]);

  const unique = getUniqueIncludedItems(packet);
  const keys = unique.map((item) => [item.type, item.path, item.heading ?? ""].join(":"));
  assert.equal(new Set(keys).size, keys.length);
});

test("packet redacts secret-like content", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(
    workspace,
    "src/auth/secret-example.ts",
    'export const apiKey = "sk-1234567890abcdefghijklmnop";\n'
  );

  const { packet } = await buildContextPacket({
    pin: ["src/auth/secret-example.ts"],
    task: "Review auth secret handling",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  const serialized = JSON.stringify(packet);
  assert.ok(!serialized.includes("sk-1234567890abcdefghijklmnop"));
  assert.ok(serialized.includes("[REDACTED:openai_api_key]"));
  assert.ok(packet.security.redactions_applied >= 1);
});

test("HTML report is generated for a packet", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  const reportPath = await writeHtmlReport(workspace, packet);
  const report = await fs.readFile(reportPath, "utf8");
  assert.ok(report.includes("Context Delta Report"));
  assert.ok(report.includes("Packet Insight"));
  assert.ok(report.includes("Saved"));
});

test("metrics summary includes risk and budget aggregation", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  await writePacketAndMetrics(workspace, packet);

  const summary = await readMetricsSummary(workspace);
  assert.equal(summary.sessions, 1);
  assert.equal(summary.risk_counts[packet.insights.risk_level], 1);
  assert.equal(summary.budget_pressure_counts[packet.budget.pressure], 1);
});

test("coverage edges surface importing tests and resolve re-exports", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(workspace, "src/billing/charge.ts", "export function charge() { return 1; }\n");
  // Re-export barrel: previously missed because the graph ignored `export ... from`.
  await writeFile(workspace, "src/billing/index.ts", 'export { charge } from "./charge";\n');
  await writeFile(
    workspace,
    "src/billing/consumer.ts",
    'import { charge } from "./index";\nexport const total = charge();\n'
  );
  await writeFile(
    workspace,
    "tests/billing/charge.test.ts",
    'import { charge } from "../../src/billing/charge";\ntest("charge", () => { expect(charge()).toBe(1); });\n'
  );

  const scan = await scanWorkspace(workspace);
  await writeSnapshot(workspace, scan.files);
  await fs.appendFile(path.join(workspace, "src/billing/charge.ts"), "\nexport const updated = true;\n");

  const { packet } = await buildContextPacket({
    task: "update billing charge",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  // The test that imports the changed file is flagged as a covering test (not luck).
  const coveringTest = packet.supporting_evidence.find(
    (item) => item.path === "tests/billing/charge.test.ts"
  );
  assert.ok(coveringTest, "the test importing the changed file should be included");
  assert.match(coveringTest.reason, /Covering test/);
  assert.ok(coveringTest.coverage_targets?.includes("src/billing/charge.ts"));

  // The `export ... from` re-export barrel is resolved as a dependent of the change.
  assert.ok(
    packet.impacted_neighbors.some((item) => item.path === "src/billing/index.ts"),
    "re-export barrel should be found via the import graph"
  );
});

test("source graph and coverage edges work for Python imports", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(workspace, "app/__init__.py", "");
  await writeFile(workspace, "app/auth/__init__.py", "");
  await writeFile(workspace, "app/auth/service.py", "def login():\n    return True\n");
  // Relative import (from .service) — resolved against the file's package.
  await writeFile(workspace, "app/auth/handler.py", "from .service import login\n\ndef handle():\n    return login()\n");
  // Absolute intra-repo import (from app.auth.service) — resolved from repo root.
  await writeFile(workspace, "app/main.py", "from app.auth.service import login\n\ndef run():\n    return login()\n");
  // pytest-style test (test_*.py) importing the changed module.
  await writeFile(workspace, "tests/test_service.py", "from app.auth.service import login\n\ndef test_login():\n    assert login() is True\n");

  const scan = await scanWorkspace(workspace);
  assert.equal(scan.files.find((file) => file.path === "tests/test_service.py")?.kind, "test");
  await writeSnapshot(workspace, scan.files);
  await fs.appendFile(path.join(workspace, "app/auth/service.py"), "\ndef logout():\n    return True\n");

  const { packet } = await buildContextPacket({
    task: "update auth service",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  const neighbors = packet.impacted_neighbors.map((item) => item.path);
  assert.ok(neighbors.includes("app/auth/handler.py"), "relative python import should be a neighbor");
  assert.ok(neighbors.includes("app/main.py"), "absolute python import should be a neighbor");
  const coveringTest = packet.supporting_evidence.find((item) => item.path === "tests/test_service.py");
  assert.ok(coveringTest && /Covering test/.test(coveringTest.reason), "python test should be a covering test");
});

test("redaction corpus: every secret type is redacted and secret files excluded", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(
    workspace,
    "src/config/secrets.ts",
    [
      'export const openaiKey = "sk-abcdefGHIJKLMNOP1234567890";',
      "// legacy env dump:",
      "// password=hunter2supersecret",
      "// api_key=ak_live_0987654321zyxwvut",
      "const pem = `-----BEGIN RSA PRIVATE KEY-----",
      "MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Q",
      "-----END RSA PRIVATE KEY-----`;"
    ].join("\n") + "\n"
  );
  // Policy must exclude these whole files regardless of content.
  await writeFile(workspace, ".env", "OPENAI_API_KEY=sk-shouldnotappear1234567890abcd\n");
  await writeFile(workspace, "keys/server.pem", "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n");

  const { packet } = await buildContextPacket({
    task: "wire up the secrets config module",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  const serialized = JSON.stringify(packet);

  // No raw secret value ever appears in the packet.
  assert.ok(!serialized.includes("sk-abcdefGHIJKLMNOP1234567890"));
  assert.ok(!serialized.includes("hunter2supersecret"));
  assert.ok(!serialized.includes("ak_live_0987654321zyxwvut"));
  assert.ok(!serialized.includes("MIIBOgIBAAJBAKj34"));

  // Every default pattern fires.
  assert.ok(serialized.includes("[REDACTED:openai_api_key]"));
  assert.ok(serialized.includes("[REDACTED:generic_assignment_secret]"));
  assert.ok(serialized.includes("[REDACTED:private_key_block]"));
  assert.ok(packet.security.redactions_applied >= 3);

  // Policy-excluded files (.env, *.pem) never enter the packet.
  assert.ok(!packet.changed_artifacts.some((item) => item.path === ".env"));
  assert.ok(!serialized.includes("sk-shouldnotappear1234567890abcd"));
});

test("engine degrades gracefully on cyclic imports, empty repos, and bad config", async () => {
  // Cyclic imports must not hang the graph traversal.
  const cyclic = await createFixtureWorkspace();
  await writeFile(cyclic, "src/cycle/a.ts", 'import { b } from "./b";\nexport const a = 1;\n');
  await writeFile(cyclic, "src/cycle/b.ts", 'import { a } from "./a";\nexport const b = 2;\n');
  const cyclicScan = await scanWorkspace(cyclic);
  await writeSnapshot(cyclic, cyclicScan.files);
  await fs.appendFile(path.join(cyclic, "src/cycle/a.ts"), "\nexport const a2 = 1;\n");
  const cyclicResult = await buildContextPacket({ task: "touch a", updateSnapshot: false, workspaceRoot: cyclic });
  assert.ok(cyclicResult.packet.id);
  assert.ok(cyclicResult.packet.impacted_neighbors.some((item) => item.path === "src/cycle/b.ts"));

  // A workspace with effectively no relevant code still produces a valid packet.
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), "context-delta-empty-"));
  await writeFile(empty, "README.md", "# Empty\n");
  const emptyResult = await buildContextPacket({ task: "do something", updateSnapshot: false, workspaceRoot: empty });
  assert.ok(emptyResult.packet.id);
  assert.ok(Array.isArray(emptyResult.packet.changed_artifacts));

  // Malformed config must fall back to defaults rather than throw.
  const badConfig = await createFixtureWorkspace();
  await writeFile(badConfig, "contextdelta.config.json", "{ this is not valid json ]");
  const badResult = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: badConfig
  });
  assert.ok(badResult.packet.id);
  assert.equal(badResult.packet.controls.mode, "balanced");
});

test("metrics rollup breaks down savings by model and agent", async () => {
  const workspace = await createFixtureWorkspace();
  for (const model of ["gpt-4o", "gpt-4o", "gpt-4"]) {
    const { packet } = await buildContextPacket({
      task: "Add refresh token rotation for admin users",
      model,
      target: "mcp-prepare-context",
      updateSnapshot: false,
      workspaceRoot: workspace
    });
    await writePacketAndMetrics(workspace, packet);
  }

  const summary = await readMetricsSummary(workspace);
  assert.equal(summary.sessions, 3);
  assert.equal(summary.by_target_model["gpt-4o"].sessions, 2);
  assert.equal(summary.by_target_model["gpt-4"].sessions, 1);
  assert.ok(summary.by_agent_host["mcp-prepare-context"].sessions === 3);
  for (const group of Object.values(summary.by_target_model)) {
    assert.ok(Number.isFinite(group.average_context_reduction_percent));
    assert.ok(group.tokens_saved_estimate >= 0);
  }
});

test("spec-to-code traceability surfaces specs that reference changed code", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(workspace, "src/billing/invoice.ts", "export function renderInvoice(id) {\n  return id;\n}\n");
  // The spec references the changed file and symbol, but uses words the task
  // does not, so only traceability (not keyword ranking) can surface it.
  await writeFile(
    workspace,
    "specs/billing/spec.md",
    "# Billing\n\n## Invoice rendering\n\nThe module src/billing/invoice.ts must produce a PDF. renderInvoice handles layout and totals.\n"
  );

  const scan = await scanWorkspace(workspace);
  await writeSnapshot(workspace, scan.files);
  await fs.appendFile(path.join(workspace, "src/billing/invoice.ts"), "\nexport function renderInvoiceV2(id) {\n  return id;\n}\n");

  const { packet } = await buildContextPacket({
    task: "harden the invoice flow",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  const trace = packet.supporting_evidence.find(
    (item) => item.path === "specs/billing/spec.md" && /Spec traces to changed code/.test(item.reason ?? "")
  );
  assert.ok(trace, "spec section referencing the changed file should be traced in");
});

test("source graph resolves Go module imports and coverage", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(workspace, "go.mod", "module example.com/app\n\ngo 1.22\n");
  await writeFile(workspace, "pkg/auth/service.go", "package auth\n\nfunc Login(user string) bool {\n\treturn user != \"\"\n}\n");
  // Consumer imports the auth package via its fully-qualified module path.
  await writeFile(
    workspace,
    "cmd/main.go",
    'package main\n\nimport (\n\t"fmt"\n\t"example.com/app/pkg/auth"\n)\n\nfunc main() {\n\tfmt.Println(auth.Login("admin"))\n}\n'
  );
  // External test package imports the package under test (coverage via import).
  await writeFile(
    workspace,
    "pkg/auth/service_ext_test.go",
    'package auth_test\n\nimport (\n\t"testing"\n\t"example.com/app/pkg/auth"\n)\n\nfunc TestLogin(t *testing.T) {\n\tif !auth.Login("x") {\n\t\tt.Fail()\n\t}\n}\n'
  );

  const scan = await scanWorkspace(workspace);
  await writeSnapshot(workspace, scan.files);
  await fs.appendFile(path.join(workspace, "pkg/auth/service.go"), "\nfunc Logout() bool { return true }\n");

  const { packet } = await buildContextPacket({
    task: "update auth login",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  assert.ok(
    packet.impacted_neighbors.some((item) => item.path === "cmd/main.go"),
    "go module import should resolve as a neighbor"
  );
  const coveringTest = packet.supporting_evidence.find((item) => item.path === "pkg/auth/service_ext_test.go");
  assert.ok(coveringTest && /Covering test/.test(coveringTest.reason), "go external test should be a covering test");
});

test("packet history and diff compare previous and current packets", async () => {
  const workspace = await createFixtureWorkspace();
  const first = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  await writePacketAndMetrics(workspace, first.packet);

  const second = await buildContextPacket({
    pin: ["docs/missing-runbook.md"],
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  const outputPaths = await writePacketAndMetrics(workspace, second.packet);

  const history = await listPacketHistory(workspace);
  const previous = await readPreviousPacket(workspace, second.packet.id);
  const diff = buildPacketDiff(previous, second.packet);

  assert.ok(history.length >= 2);
  assert.equal(previous.id, first.packet.id);
  assert.ok(diff.added.some((item) => item.path === "docs/missing-runbook.md"));
  assert.ok(outputPaths.latestDiffPath.endsWith("latest-diff.json"));
});

test("pinning a directory expands to the files under it", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(workspace, "docs/site/styles.css", ".hero { display: grid; }\n");
  await writeFile(workspace, "docs/site/site.js", "window.cd = true;\n");

  // Establish a snapshot baseline so the pinned files aren't treated as changed
  // (changed files are surfaced as changed_artifacts, not pinned).
  await buildContextPacket({
    task: "baseline",
    updateSnapshot: true,
    workspaceRoot: workspace
  });

  const { packet } = await buildContextPacket({
    pin: ["docs/site"],
    task: "Review the site front-end",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  const pinned = packet.supporting_evidence.filter((item) => item.type === "pinned");
  const pinnedPaths = pinned.map((item) => item.path);

  // The directory pin resolved to real files, not a missing_pinned placeholder.
  assert.ok(pinnedPaths.includes("docs/site/styles.css"));
  assert.ok(pinnedPaths.includes("docs/site/site.js"));
  assert.ok(pinned.every((item) => typeof item.content === "string"));
  assert.ok(!packet.supporting_evidence.some((item) => item.type === "missing_pinned"));
  assert.ok(pinned.every((item) => item.reason.includes("pinned directory docs/site")));

  // A genuinely absent pin still reports as missing.
  const { packet: missingPacket } = await buildContextPacket({
    pin: ["this/path/does/not/exist"],
    task: "Review the site front-end",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  assert.ok(
    missingPacket.supporting_evidence.some(
      (item) => item.type === "missing_pinned" && item.path === "this/path/does/not/exist"
    )
  );
});

test("a pinned file is not duplicated as ranked supporting evidence", async () => {
  const workspace = await createFixtureWorkspace();
  // Baseline so the test file isn't surfaced as a changed artifact instead.
  await buildContextPacket({ task: "baseline", updateSnapshot: true, workspaceRoot: workspace });

  // Pinning the tests directory makes admin-refresh.test.ts a pinned item; the
  // auth task also ranks it as a nearby test. It must be delivered only once.
  const { packet } = await buildContextPacket({
    pin: ["tests"],
    task: "Add admin refresh token rotation and cover it with tests",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  const testPath = "tests/auth/admin-refresh.test.ts";
  const occurrences = packet.supporting_evidence.filter((item) => item.path === testPath);
  assert.equal(occurrences.length, 1, "pinned test must not also appear as ranked supporting evidence");
});

test("a pinned file is not also delivered as an impacted neighbor", async () => {
  const workspace = await createFixtureWorkspace();
  // docs/site/styles.css exists in the fixture. Pinning it AND using a task whose
  // keywords match its path ("site"/"styles") previously caused it to land in both
  // supporting_evidence (pinned) and impacted_neighbors (graph neighbor).
  const { packet } = await buildContextPacket({
    pin: ["docs/site/styles.css"],
    task: "Review the site styles layout for responsive issues",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  const buckets = {
    changed: packet.changed_artifacts.map((item) => item.path),
    governing: packet.governing_constraints.map((item) => item.path),
    supporting: packet.supporting_evidence.map((item) => item.path),
    neighbors: packet.impacted_neighbors.map((item) => item.path)
  };

  // The pinned file is delivered exactly once, in a primary bucket, never as a neighbor.
  const pinnedPath = "docs/site/styles.css";
  assert.ok(buckets.supporting.includes(pinnedPath));
  assert.ok(!buckets.neighbors.includes(pinnedPath));

  // General invariant: impacted_neighbors never overlaps a primary bucket path.
  const primaryPaths = new Set([...buckets.changed, ...buckets.governing, ...buckets.supporting]);
  for (const neighborPath of buckets.neighbors) {
    assert.ok(!primaryPaths.has(neighborPath), `neighbor ${neighborPath} duplicates a primary bucket`);
  }
});

test("incremental handoff sends new context and references retained context", async () => {
  const workspace = await createFixtureWorkspace();
  const first = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  await writePacketAndMetrics(workspace, first.packet);

  await writeFile(
    workspace,
    "docs/rotation-runbook.md",
    "# Rotation Runbook\n\nRotate admin refresh tokens every 24 hours and revoke on logout.\n"
  );
  const second = await buildContextPacket({
    pin: ["docs/rotation-runbook.md"],
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  const previous = await readPreviousPacket(workspace, second.packet.id);
  const model = buildIncrementalHandoffModel(second.packet, previous);

  // The new doc carries content this turn; most prior context should be retained, not resent.
  const newPaths = model.new_buckets.flatMap((bucket) => bucket.items.map((item) => item.path));
  assert.ok(newPaths.includes("docs/rotation-runbook.md"));
  assert.ok(model.retained.length > 0);
  assert.ok(model.tokens.new_tokens_estimate > 0);
  assert.ok(model.tokens.retained_tokens_estimate > 0);
  assert.ok(model.tokens.saved_percent > 0 && model.tokens.saved_percent < 100);

  const handoff = renderHandoff(second.packet, { format: "incremental", previousPacket: previous });
  assert.ok(handoff.includes("Context Delta Incremental Handoff"));
  assert.ok(handoff.includes("Retained Context"));
  assert.ok(handoff.includes("do not re-request"));
  assert.ok(handoff.includes("docs/rotation-runbook.md"));

  // First turn (no previous packet) falls back to a full handoff with a clear note.
  const firstTurn = renderHandoff(first.packet, { format: "incremental", previousPacket: null });
  assert.ok(firstTurn.includes("treated as the first turn"));
});

test("handoff renderer produces prompt-ready formats", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(
    workspace,
    "docs/fenced-example.md",
    "# Fenced Example\n\n```bash\nnpm test\n```\n"
  );
  const { packet } = await buildContextPacket({
    pin: ["docs/fenced-example.md"],
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  const copilot = renderHandoff(packet, { format: "copilot" });
  const specKit = renderHandoff(packet, { format: "spec-kit" });
  const compact = renderHandoff(packet, { format: "compact" });
  const replay = renderHandoff(packet, { format: "replay" });
  const riskHeader = renderRiskHeader(packet);

  assert.ok(copilot.includes("Context Delta Handoff For GitHub Copilot"));
  assert.ok(specKit.includes("Spec-Driven Guidance"));
  assert.ok(replay.includes("Context Delta Replay"));
  assert.ok(riskHeader.includes("Context ready"));
  assert.ok(riskHeader.includes("risk="));
  assert.ok(copilot.includes("````text"));
  assert.equal(JSON.parse(compact).id, packet.id);
});

test("manager summary writes markdown and JSON reports", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  await writePacketAndMetrics(workspace, packet);

  const result = await writeManagerSummary(workspace);
  const markdown = await fs.readFile(result.markdownPath, "utf8");
  const json = JSON.parse(await fs.readFile(result.jsonPath, "utf8"));

  assert.ok(markdown.includes("Context Delta Repo Summary"));
  assert.equal(json.summary.sessions, 1);
});

test("setup status renders first-run readiness checks", async () => {
  const workspace = await createFixtureWorkspace();
  const status = await getSetupStatus(workspace, { target: "cli" });
  const markdown = renderSetupMarkdown(status);

  assert.equal(status.workspace_root, workspace);
  assert.equal(status.target, "cli");
  assert.equal(status.status, "ready");
  assert.ok(status.checks.some((item) => item.name === "workspace" && item.ok));
  assert.ok(status.checks.some((item) => item.name === "node" && item.ok));
  assert.ok(status.checks.some((item) => item.name === "vscode_extension" && item.optional));
  assert.ok(status.mcp.server.args[0].includes("packages/mcp-server/bin/context-delta-mcp.js"));
  assert.ok(markdown.includes("Context Delta Setup"));
  assert.ok(markdown.includes("Target: CLI handoff"));
  assert.ok(markdown.includes("Next Best Action"));
});

test("stale manual controls can be cleaned from config", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(
    workspace,
    "contextdelta.config.json",
    JSON.stringify(
      {
        schema_version: "0.1",
        controls: {
          exclude: ["docs/missing.md", "docs/legacy-oauth.md"],
          pin: ["src/auth/service.ts", "src/missing.ts"]
        }
      },
      null,
      2
    )
  );

  const result = await cleanupStaleControls(workspace);
  const config = JSON.parse(await fs.readFile(result.config_path, "utf8"));

  assert.equal(result.removed_count, 2);
  assert.deepEqual(config.controls.exclude, ["docs/legacy-oauth.md"]);
  assert.deepEqual(config.controls.pin, ["src/auth/service.ts"]);
});

test("drift review flags current changes outside the latest packet", async () => {
  const workspace = await createFixtureWorkspace();
  await execFileAsync("git", ["-C", workspace, "init"]);
  await execFileAsync("git", ["-C", workspace, "add", "."]);
  await execFileAsync("git", [
    "-C",
    workspace,
    "-c",
    "user.name=Context Delta Test",
    "-c",
    "user.email=context-delta@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "initial fixture"
  ]);

  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  await writePacketFile(workspace, packet);
  await writeFile(workspace, "src/billing/service.ts", "export const billing = true;\n");

  const review = await reviewContextDrift(workspace);
  const markdown = renderContextDriftMarkdown(review);

  assert.equal(review.packet_id, packet.id);
  assert.ok(review.changed_outside_packet.includes("src/billing/service.ts"));
  assert.equal(review.packet_task_stale, true);
  assert.ok(["medium", "high"].includes(review.risk));
  assert.equal(review.risk, "high");
  assert.ok(markdown.includes("Context Delta Drift Review"));
  assert.ok(markdown.includes("Packet task stale: yes"));
});

test("packet-quality eval scores a local gold set", async () => {
  const workspace = await createFixtureWorkspace();
  await writeFile(
    workspace,
    "eval/gold-set.json",
    JSON.stringify(
      {
        cases: [
          {
            id: "auth-refresh",
            task: "Add refresh token rotation for admin users",
            minimum_context: {
              paths: [
                ".github/copilot-instructions.md",
                "specs/004-admin-auth/spec.md",
                "src/auth/service.ts",
                "src/auth/token-store.ts",
                "tests/auth/admin-refresh.test.ts"
              ]
            },
            pass: {
              max_omission_rate: 0.25,
              min_impact_coverage: 0.75,
              min_useful_context_density: 0.35
            }
          }
        ]
      },
      null,
      2
    )
  );

  const result = await runPacketEval(workspace, { writeOutputs: true });
  assert.equal(result.report.summary.cases, 1);
  assert.equal(result.report.results[0].case_id, "auth-refresh");
  assert.ok(result.report.results[0].useful_context_density_percent > 0);
  assert.ok(result.output_paths.jsonPath.endsWith("latest-eval.json"));
});

test("packet-quality eval can score cases across multiple workspace shapes", async () => {
  const suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "context-delta-eval-suite-"));
  const siteWorkspace = path.join(suiteRoot, "workspaces", "site");
  await writeFile(siteWorkspace, "docs/index.html", "<main class=\"hero\">Context Delta</main>\n");
  await writeFile(siteWorkspace, "docs/site/styles.css", ".hero { display: grid; }\n");
  await writeFile(siteWorkspace, "docs/site/site.js", "document.body.dataset.ready = 'true';\n");
  await writeFile(siteWorkspace, "docs/archive/old.md", "# Old notes\n");
  await writeFile(
    suiteRoot,
    "gold-set.json",
    JSON.stringify(
      {
        cases: [
          {
            exclude: ["docs/archive/"],
            id: "site-review",
            minimum_context: {
              paths: ["docs/index.html", "docs/site/styles.css", "docs/site/site.js"]
            },
            pass: {
              max_forbidden: 0,
              max_omission_rate: 0,
              min_impact_coverage: 1,
              min_useful_context_density: 0.75
            },
            task: "Review responsive static site layout",
            workspace: "workspaces/site"
          }
        ]
      },
      null,
      2
    )
  );

  const result = await runPacketEval(suiteRoot, { casesPath: "gold-set.json" });
  assert.equal(result.report.summary.cases, 1);
  assert.equal(result.report.summary.passed, 1);
  assert.equal(result.report.results[0].workspace, "workspaces/site");
  assert.ok(result.report.results[0].workspace_root.endsWith("workspaces/site"));
});

test("approval and replay write review artifacts", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });

  const approval = await writePacketApproval(workspace, packet, {
    decision: "approved",
    notes: "Ready for handoff"
  });
  const replay = renderReplayPrompt(packet);

  assert.equal(approval.approval.decision, "approved");
  assert.ok(approval.latestPath.endsWith("latest.json"));
  assert.ok(replay.includes("Context Delta Replay"));
  assert.ok(replay.includes(packet.id));
});

test("CLI emits JSON packet output", async () => {
  const workspace = await createFixtureWorkspace();
  const cliPath = path.resolve("packages/cli/bin/context-delta.js");
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "packet",
    "Add refresh token rotation for admin users",
    "--workspace",
    workspace,
    "--json",
    "--dry-run",
    "--no-snapshot"
  ]);

  const output = JSON.parse(stdout);
  assert.equal(output.packet.schema_version, "0.1");
  assert.equal(output.output_paths, null);
  assert.ok(output.packet.summary.included_files_count > 0);
});

test("CLI prepare infers a task and emits a risk header", async () => {
  const workspace = await createFixtureWorkspace();
  const cliPath = path.resolve("packages/cli/bin/context-delta.js");
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "prepare",
    "--workspace",
    workspace,
    "--json",
    "--dry-run"
  ]);

  const output = JSON.parse(stdout);
  assert.equal(output.inferred_task, true);
  assert.ok(output.task.includes("Review"));
  assert.ok(output.risk_header.includes("Context ready"));
  assert.ok(output.packet_id.startsWith("packet-"));
});

test("CLI reads latest packet insights and compact views", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  await writePacketFile(workspace, packet);

  const cliPath = path.resolve("packages/cli/bin/context-delta.js");
  const insights = await execFileAsync(process.execPath, [
    cliPath,
    "insights",
    "--workspace",
    workspace,
    "--json"
  ]);
  const compact = await execFileAsync(process.execPath, [
    cliPath,
    "compact",
    "--workspace",
    workspace,
    "--json"
  ]);

  assert.equal(JSON.parse(insights.stdout).risk_level, packet.insights.risk_level);
  assert.equal(JSON.parse(compact.stdout).id, packet.id);
});

test("CLI renders handoff, history, diff, and manager summary", async () => {
  const workspace = await createFixtureWorkspace();
  const cliPath = path.resolve("packages/cli/bin/context-delta.js");

  await execFileAsync(process.execPath, [
    cliPath,
    "packet",
    "Add refresh token rotation for admin users",
    "--workspace",
    workspace
  ]);
  await execFileAsync(process.execPath, [
    cliPath,
    "packet",
    "Add refresh token rotation for admin users",
    "--workspace",
    workspace,
    "--pin",
    "docs/legacy-oauth.md"
  ]);

  const handoff = await execFileAsync(process.execPath, [
    cliPath,
    "handoff",
    "--workspace",
    workspace,
    "--format",
    "copilot"
  ]);
  const history = await execFileAsync(process.execPath, [
    cliPath,
    "history",
    "--workspace",
    workspace,
    "--json"
  ]);
  const diff = await execFileAsync(process.execPath, [
    cliPath,
    "diff",
    "--workspace",
    workspace,
    "--json"
  ]);
  const summary = await execFileAsync(process.execPath, [
    cliPath,
    "summary",
    "--workspace",
    workspace,
    "--json"
  ]);
  const setup = await execFileAsync(process.execPath, [
    cliPath,
    "setup",
    "--workspace",
    workspace,
    "--json"
  ]);
  const drift = await execFileAsync(process.execPath, [
    cliPath,
    "drift",
    "--workspace",
    workspace,
    "--json"
  ]);
  await writeFile(
    workspace,
    "eval/gold-set.json",
    JSON.stringify({
      cases: [
        {
          id: "auth-refresh",
          task: "Add refresh token rotation for admin users",
          minimum_context: {
            paths: ["specs/004-admin-auth/spec.md", "src/auth/service.ts"]
          }
        }
      ]
    })
  );
  const evaluation = await execFileAsync(process.execPath, [
    cliPath,
    "eval",
    "--workspace",
    workspace,
    "--json"
  ]);
  const approval = await execFileAsync(process.execPath, [
    cliPath,
    "approve",
    "--workspace",
    workspace,
    "--json"
  ]);
  const replay = await execFileAsync(process.execPath, [
    cliPath,
    "replay",
    "--workspace",
    workspace
  ]);

  assert.ok(handoff.stdout.includes("GitHub Copilot"));
  assert.ok(JSON.parse(history.stdout).history.length >= 2);
  assert.ok(JSON.parse(diff.stdout).summary.added_count >= 1);
  assert.equal(JSON.parse(summary.stdout).summary.sessions, 2);
  assert.ok(JSON.parse(setup.stdout).status.checks.some((item) => item.name === "workspace"));
  assert.ok(JSON.parse(drift.stdout).packet_id.startsWith("packet-"));
  assert.equal(JSON.parse(evaluation.stdout).report.summary.cases, 1);
  assert.equal(JSON.parse(approval.stdout).approval.decision, "approved");
  assert.ok(replay.stdout.includes("Context Delta Replay"));
});

test("CLI init writes default config", async () => {
  const workspace = await createFixtureWorkspace();
  const cliPath = path.resolve("packages/cli/bin/context-delta.js");
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "init",
    "--workspace",
    workspace,
    "--json"
  ]);

  const output = JSON.parse(stdout);
  assert.equal(output.created, true);
  const config = JSON.parse(await fs.readFile(output.path, "utf8"));
  assert.equal(config.schema_version, "0.1");
});

test("CLI controls cleanup removes stale paths", async () => {
  const workspace = await createFixtureWorkspace();
  const cliPath = path.resolve("packages/cli/bin/context-delta.js");
  await writeFile(
    workspace,
    "contextdelta.config.json",
    JSON.stringify({
      controls: {
        exclude: ["docs/missing.md", "docs/legacy-oauth.md"],
        pin: ["src/auth/service.ts", "src/missing.ts"]
      }
    })
  );

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "controls",
    "--workspace",
    workspace,
    "--cleanup-stale",
    "--json"
  ]);

  const output = JSON.parse(stdout);
  assert.equal(output.removed_count, 2);
  assert.deepEqual(output.controls.pin, ["src/auth/service.ts"]);
});

test("MCP server lists Context Delta tools", async () => {
  const mcpPath = path.resolve("packages/mcp-server/bin/context-delta-mcp.js");
  const child = spawn(process.execPath, [mcpPath], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  try {
    const responsePromise = readJsonLine(child.stdout);
    child.stdin.write(
      `${JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "tools/list"
      })}\n`
    );
    const response = await responsePromise;
    assert.equal(response.id, 1);
    assert.ok(response.result.tools.some((tool) => tool.name === "prepare_context"));
    assert.ok(response.result.tools.some((tool) => tool.name === "check_context_setup"));
    assert.ok(response.result.tools.some((tool) => tool.name === "review_context_drift"));
    assert.ok(response.result.tools.some((tool) => tool.name === "get_context_packet"));
    assert.ok(response.result.tools.some((tool) => tool.name === "get_context_insights"));
    assert.ok(response.result.tools.some((tool) => tool.name === "render_context_handoff"));
    assert.ok(response.result.tools.some((tool) => tool.name === "generate_manager_summary"));
    assert.ok(response.result.tools.some((tool) => tool.name === "run_context_eval"));
    assert.ok(response.result.tools.some((tool) => tool.name === "approve_context_packet"));
  } finally {
    child.kill();
  }
});

test("MCP prepare_context returns an agent-ready handoff", async () => {
  const workspace = await createFixtureWorkspace();
  const mcpPath = path.resolve("packages/mcp-server/bin/context-delta-mcp.js");
  const child = spawn(process.execPath, [mcpPath], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  try {
    const responsePromise = readJsonLine(child.stdout);
    child.stdin.write(
      `${JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: {
            task: "Add refresh token rotation for admin users",
            workspaceRoot: workspace,
            writeOutputs: false
          },
          name: "prepare_context"
        }
      })}\n`
    );
    const response = await responsePromise;
    assert.equal(response.id, 1);
    assert.equal(response.result.structuredContent.task, "Add refresh token rotation for admin users");
    assert.ok(response.result.structuredContent.risk_header.includes("Context ready"));
    assert.ok(response.result.content[0].text.includes("Context Delta Prepared Context"));
    assert.ok(response.result.content[0].text.includes("Operating Guidance"));
  } finally {
    child.kill();
  }
});

test("MCP server lists and reads resources", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  await writePacketFile(workspace, packet);

  const mcpPath = path.resolve("packages/mcp-server/bin/context-delta-mcp.js");
  const child = spawn(process.execPath, [mcpPath], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  try {
    let responsePromise = readJsonLine(child.stdout);
    child.stdin.write(
      `${JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "resources/list"
      })}\n`
    );
    const listResponse = await responsePromise;
    assert.ok(
      listResponse.result.resources.some(
        (resource) => resource.uri === "contextdelta://packet/current"
      )
    );
    assert.ok(
      listResponse.result.resources.some(
        (resource) => resource.uri === "contextdelta://packet/compact"
      )
    );
    assert.ok(
      listResponse.result.resources.some(
        (resource) => resource.uri === "contextdelta://handoff/markdown"
      )
    );
    assert.ok(
      listResponse.result.resources.some(
        (resource) => resource.uri === "contextdelta://metrics/manager-summary"
      )
    );
    assert.ok(
      listResponse.result.resources.some(
        (resource) => resource.uri === "contextdelta://packet/replay"
      )
    );
    assert.ok(
      listResponse.result.resources.some(
        (resource) => resource.uri === "contextdelta://packet/drift"
      )
    );
    assert.ok(
      listResponse.result.resources.some(
        (resource) => resource.uri === "contextdelta://setup/status"
      )
    );

    responsePromise = readJsonLine(child.stdout);
    child.stdin.write(
      `${JSON.stringify({
        id: 2,
        jsonrpc: "2.0",
        method: "resources/read",
        params: {
          arguments: {
            workspaceRoot: workspace
          },
          uri: "contextdelta://packet/current"
        }
      })}\n`
    );
    const readResponse = await responsePromise;
    assert.equal(readResponse.result.contents[0].uri, "contextdelta://packet/current");
    assert.ok(readResponse.result.contents[0].text.includes(packet.id));
  } finally {
    child.kill();
  }
});

test("writeDefaultConfig does not overwrite existing config unless forced", async () => {
  const workspace = await createFixtureWorkspace();
  const first = await writeDefaultConfig(workspace);
  const second = await writeDefaultConfig(workspace);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
});

async function createFixtureWorkspace() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "context-delta-test-"));
  await writeFile(
    workspace,
    "specs/004-admin-auth/spec.md",
    `# Admin Auth

## Refresh token rotation

Admin refresh tokens must rotate after each successful refresh request.
Reusing an old token should revoke the session.

## Acceptance criteria

- Admin users receive a new refresh token.
- The old token can no longer be used.
`
  );
  await writeFile(
    workspace,
    ".github/copilot-instructions.md",
    `# Copilot Instructions

## Security

Token changes must include tests and avoid logging secrets.
`
  );
  await writeFile(
    workspace,
    "src/auth/service.ts",
    `export function refreshToken(user) {
  return { token: user.id };
}
`
  );
  await writeFile(
    workspace,
    "src/auth/token-store.ts",
    `export function saveToken(token) {
  return token;
}
`
  );
  await writeFile(
    workspace,
    "tests/auth/admin-refresh.test.ts",
    `import { refreshToken } from "../../src/auth/service";

test("rotates admin refresh token", () => {
  expect(refreshToken({ id: "admin" })).toBeTruthy();
});
`
  );
  await writeFile(
    workspace,
    "docs/legacy-oauth.md",
    `# Legacy OAuth

This is historical migration documentation.
`
  );

  return workspace;
}

async function writeFile(workspace, relativePath, content) {
  const absolutePath = path.join(workspace, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content);
}

async function writePacketFile(workspace, packet) {
  const packetPath = path.join(workspace, ".contextdelta", "packets", "latest.json");
  await fs.mkdir(path.dirname(packetPath), { recursive: true });
  await fs.writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`);
}

function readJsonLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for MCP response")), 2_000);

    stream.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      clearTimeout(timeout);
      const line = buffer.slice(0, newlineIndex);
      resolve(JSON.parse(line));
    });

    stream.on("error", reject);
  });
}

// --- Content/symbol/IDF relevance ranking (locks in the ranking upgrade) ---

test("tokenizeIdentifier splits compound symbol names into matchable terms", () => {
  const camel = tokenizeIdentifier("rotateRefreshToken");
  assert.ok(camel.includes("rotate"));
  assert.ok(camel.includes("refresh"));
  assert.ok(camel.includes("token"));
  assert.ok(camel.includes("rotaterefreshtoken"));

  const snake = tokenizeIdentifier("charge_amount");
  assert.ok(snake.includes("charge"));
  assert.ok(snake.includes("amount"));
});

test("scoreFile rewards a declared-symbol match over a content mention over neither", () => {
  const index = {
    byPath: new Map([
      ["symbol.ts", { symbolTerms: new Set(["rotate"]), termCounts: new Map() }],
      ["content.ts", { symbolTerms: new Set(), termCounts: new Map([["rotate", 2]]) }],
      ["none.ts", { symbolTerms: new Set(), termCounts: new Map() }]
    ]),
    idfFor: () => 1
  };
  const mk = (p) => ({ path: p, kind: "source", textLike: true, tooLarge: false });
  const keywords = ["rotate"];
  const empty = new Set();

  const symbolScore = scoreFile(mk("symbol.ts"), keywords, empty, index);
  const contentScore = scoreFile(mk("content.ts"), keywords, empty, index);
  const noneScore = scoreFile(mk("none.ts"), keywords, empty, index);

  assert.ok(symbolScore > contentScore, `symbol ${symbolScore} should beat content ${contentScore}`);
  assert.ok(contentScore > noneScore, `content ${contentScore} should beat none ${noneScore}`);
});

test("scoreFile weights a rarer keyword higher via IDF", () => {
  const index = {
    byPath: new Map([["f.ts", { symbolTerms: new Set(), termCounts: new Map([["common", 1], ["rare", 1]]) }]]),
    // rare term gets a higher idf multiplier than the common one
    idfFor: (term) => (term === "rare" ? 3 : 1)
  };
  const file = { path: "f.ts", kind: "source", textLike: true, tooLarge: false };
  const empty = new Set();
  const rareScore = scoreFile(file, ["rare"], empty, index);
  const commonScore = scoreFile(file, ["common"], empty, index);
  assert.ok(rareScore > commonScore, `rare ${rareScore} should beat common ${commonScore}`);
});

test("buildRelevanceIndex extracts symbols and ranks rare terms above common ones", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cd-relevance-"));
  try {
    const write = async (rel, content) => {
      const full = path.join(workspace, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
    };
    // "common" appears in every file; "rotateRefreshToken" is a rare symbol.
    await write("a.ts", "export function rotateRefreshToken() { return common(); }\n");
    await write("b.ts", "export function common() { return 1; }\n");
    await write("c.ts", "export function common2() { return common(); }\n");

    const scan = await scanWorkspace(workspace);
    const index = await buildRelevanceIndex(scan.files);

    const entryA = index.byPath.get("a.ts");
    assert.ok(entryA, "a.ts should be indexed");
    assert.ok(entryA.symbolTerms.has("rotate"), "symbol terms should include 'rotate'");
    assert.ok(entryA.symbolTerms.has("token"), "symbol terms should include 'token'");

    // A term in 1 of 3 docs is rarer than one in all 3 -> higher idf.
    assert.ok(index.idfFor("rotate") > index.idfFor("common"));
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("relevance ranking surfaces a file by symbol when its path does not match the task", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cd-symbol-rank-"));
  try {
    const write = async (rel, content) => {
      const full = path.join(workspace, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
    };
    // Generic path, but the symbol matches the task. A decoy with neither.
    await write("src/services/handler.ts", "export function rotateRefreshToken(user) { return user; }\n");
    await write("src/services/other.ts", "export function unrelatedHelper() { return 0; }\n");
    await write("README.md", "# Demo\n");

    const { packet } = await buildContextPacket({
      task: "rotate refresh token for admin",
      updateSnapshot: false,
      workspaceRoot: workspace
    });

    const included = getUniqueIncludedItems(packet).map((item) => item.path);
    assert.ok(
      included.includes("src/services/handler.ts"),
      `symbol-matched file should be included; got ${JSON.stringify(included)}`
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

// --- Instruction precedence warning (locks in the file-vs-section fix) ---

test("instruction precedence warning counts unique files and lists them, not dots", () => {
  const items = [
    { path: "AGENTS.md", type: "instruction_file", instruction_tool: "agents", precedence: 0 },
    { path: "src/auth/AGENTS.md", type: "instruction_file", instruction_tool: "agents", precedence: 2 },
    // a per-heading section of a file already counted — must not inflate the count
    { path: "AGENTS.md", type: "instruction_section", heading: "Security" }
  ];
  const warnings = buildInstructionWarnings(items);
  const precedence = warnings.find((warning) => warning.type === "instruction-precedence");
  assert.ok(precedence, "expected a precedence warning for two same-tool files");
  assert.match(precedence.message, /2 agents instruction files/);
  // higher-precedence (closer) file listed first, and no row-of-dots artifact
  assert.match(precedence.message, /src\/auth\/AGENTS\.md > AGENTS\.md/);
  assert.ok(!/: (\.,\s*)+\.\.?$/.test(precedence.message));
});

test("instruction precedence warning does not fire for distinct single-tool files", () => {
  const items = [
    { path: "AGENTS.md", type: "instruction_file", instruction_tool: "agents" },
    { path: "CLAUDE.md", type: "instruction_file", instruction_tool: "claude" },
    { path: ".github/copilot-instructions.md", type: "instruction_file", instruction_tool: "github-copilot" },
    // sections of those files must not be bucketed into a spurious "generic" group
    { path: "AGENTS.md", type: "instruction_section", heading: "A" },
    { path: "CLAUDE.md", type: "instruction_section", heading: "B" }
  ];
  const warnings = buildInstructionWarnings(items);
  assert.ok(!warnings.some((warning) => warning.type === "instruction-precedence"));
});

// --- Manual-override metric (locks in the real-count fix) ---

test("manual override metric reflects pins and excludes, and expansions field is gone", async () => {
  const workspace = await createFixtureWorkspace();
  const { packet } = await buildContextPacket({
    task: "Add refresh token rotation for admin users",
    pin: ["src/auth/service.ts"],
    exclude: ["docs/"],
    updateSnapshot: false,
    workspaceRoot: workspace
  });
  await writePacketAndMetrics(workspace, packet);
  const summary = await readMetricsSummary(workspace);
  assert.ok(summary.manual_overrides >= 2, `expected >= 2 overrides, got ${summary.manual_overrides}`);
  assert.ok(!("packet_expansions" in summary), "defunct packet_expansions should not be emitted");
});

// --- Impacted-neighbor signal filter (locks in the precision improvement) ---

test("hasRelevanceSignal distinguishes real relevance from the bare kind floor", () => {
  const index = {
    byPath: new Map([
      ["match-symbol.ts", { symbolTerms: new Set(["reorder"]), termCounts: new Map() }],
      ["match-content.ts", { symbolTerms: new Set(), termCounts: new Map([["reorder", 1]]) }],
      ["decoy.ts", { symbolTerms: new Set(), termCounts: new Map() }]
    ]),
    idfFor: () => 1
  };
  const mk = (p) => ({ path: p, kind: "source", textLike: true, tooLarge: false });
  const keywords = ["reorder"];
  const empty = new Set();

  assert.equal(hasRelevanceSignal(mk("src/reorder.ts"), keywords, empty, index), true, "path match");
  assert.equal(hasRelevanceSignal(mk("match-symbol.ts"), keywords, empty, index), true, "symbol match");
  assert.equal(hasRelevanceSignal(mk("match-content.ts"), keywords, empty, index), true, "content match");
  assert.equal(hasRelevanceSignal(mk("decoy.ts"), keywords, empty, index), false, "no signal");
  assert.equal(hasRelevanceSignal(mk("decoy.ts"), keywords, new Set(["decoy.ts"]), index), true, "changed file");
});

test("impacted neighbors exclude unrelated same-kind decoy modules", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cd-precision-"));
  try {
    const write = async (rel, content) => {
      const full = path.join(workspace, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
    };
    await write("src/reorder.ts", "export function reorderThreshold(stock, min) { return stock <= min; }\n");
    await write("src/stock.ts", 'import { reorderThreshold } from "./reorder";\nexport const flag = (s, m) => reorderThreshold(s, m);\n');
    // Decoys: same kind, unrelated to the task -> must not be surfaced.
    await write("src/billing.ts", "export function invoiceTotal(rows) { return rows.length; }\n");
    await write("src/telemetry.ts", "export function emitEvent(name) { return name; }\n");

    const { packet } = await buildContextPacket({
      task: "fix the stock reorder threshold",
      updateSnapshot: false,
      workspaceRoot: workspace
    });

    const impacted = packet.impacted_neighbors.map((item) => item.path);
    assert.ok(!impacted.includes("src/billing.ts"), `decoy billing leaked: ${JSON.stringify(impacted)}`);
    assert.ok(!impacted.includes("src/telemetry.ts"), `decoy telemetry leaked: ${JSON.stringify(impacted)}`);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

// --- Multi-language import graph (Rust, Java, Ruby, PHP) + tests/ classification ---

async function graphNeighborPaths(workspace, files, changedPath) {
  const scan = await scanWorkspace(workspace);
  const neighbors = await findSourceGraphNeighbors(scan.files, new Set([changedPath]), []);
  return neighbors.map((item) => item.path);
}

async function withWorkspace(prefix, layout, run) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    for (const [rel, content] of Object.entries(layout)) {
      const full = path.join(workspace, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
    }
    await run(workspace);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

test("source graph resolves Rust mod and use crate imports", async () => {
  await withWorkspace("cd-rust-", {
    "src/lib.rs": "pub mod auth;\n",
    "src/auth.rs": "pub fn rotate() {}\n",
    "src/app.rs": "use crate::auth::rotate;\n\nfn main() { rotate(); }\n"
  }, async (ws) => {
    const paths = await graphNeighborPaths(ws, null, "src/auth.rs");
    assert.ok(paths.includes("src/app.rs"), `app.rs should depend on auth.rs; got ${JSON.stringify(paths)}`);
    assert.ok(paths.includes("src/lib.rs"), "lib.rs declares `mod auth`");
  });
});

test("source graph resolves Java package imports by suffix", async () => {
  await withWorkspace("cd-java-", {
    "src/main/java/com/ex/Service.java": "package com.ex;\npublic class Service {}\n",
    "src/main/java/com/ex/App.java": "package com.ex;\nimport com.ex.Service;\npublic class App {}\n"
  }, async (ws) => {
    const paths = await graphNeighborPaths(ws, null, "src/main/java/com/ex/Service.java");
    assert.ok(paths.includes("src/main/java/com/ex/App.java"), `App should import Service; got ${JSON.stringify(paths)}`);
  });
});

test("source graph resolves Ruby require_relative", async () => {
  await withWorkspace("cd-ruby-", {
    "lib/auth.rb": "def rotate; end\n",
    "app.rb": "require_relative 'lib/auth'\n\nrotate\n"
  }, async (ws) => {
    const paths = await graphNeighborPaths(ws, null, "lib/auth.rb");
    assert.ok(paths.includes("app.rb"), `app.rb should require lib/auth; got ${JSON.stringify(paths)}`);
  });
});

test("source graph resolves PHP relative require and namespaced use", async () => {
  await withWorkspace("cd-php-", {
    "src/Auth.php": "<?php\nfunction rotate() {}\n",
    "src/App.php": "<?php\nrequire_once __DIR__ . '/Auth.php';\n",
    "src/Service.php": "<?php\nnamespace App;\nuse App\\Auth;\nclass Service {}\n"
  }, async (ws) => {
    const paths = await graphNeighborPaths(ws, null, "src/Auth.php");
    assert.ok(paths.includes("src/App.php"), `App.php require should resolve; got ${JSON.stringify(paths)}`);
  });
});

test("top-level tests/ directory is classified as test", () => {
  assert.equal(classifyFile("tests/billing.rs"), "test");
  assert.equal(classifyFile("test/foo.rb"), "test");
  assert.equal(classifyFile("src/billing.rs"), "source");
  // a source file that merely contains the substring must not be misread
  assert.equal(classifyFile("src/testing-utils.ts"), "source");
});

// --- Signature compression (model-free body stripping for distant context) ---

test("extractSignatures keeps declarations and drops bodies, smaller output", async () => {
  const { extractSignatures } = await import("../packages/engine/src/compression.js");
  const ts = [
    'import { x } from "./x";',
    "export function rotate(token, admin) {",
    "  const a = compute(token);",
    "  if (admin) { return escalate(a); }",
    "  return a;",
    "}"
  ].join("\n");
  const skeleton = extractSignatures(ts, "src/auth.ts");
  assert.ok(skeleton, "should produce a skeleton for a brace language");
  assert.ok(skeleton.includes("export function rotate(token, admin)"), "keeps the signature");
  assert.ok(!skeleton.includes("escalate"), "drops body internals");
  assert.ok(skeleton.length < ts.length, "skeleton is smaller");

  const py = ["import os", "", "def charge(amount):", "    if amount <= 0:", "        raise ValueError('bad')", "    return amount"].join("\n");
  const pySkeleton = extractSignatures(py, "pay.py");
  assert.ok(pySkeleton.includes("def charge(amount):"), "keeps python def header");
  assert.ok(!pySkeleton.includes("ValueError"), "drops python body");

  assert.equal(extractSignatures("plain text", "notes.txt"), null, "non-code returns null");
});

test("distant graph neighbors are sent as signature skeletons", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cd-compress-"));
  try {
    const write = async (rel, content) => {
      const full = path.join(workspace, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
    };
    // core <- mid <- app : app is 2 hops from core
    await write("src/core.ts", "export function core(x) { return x + 1; }\n");
    await write("src/mid.ts", 'import { core } from "./core";\nexport function mid(x) { return core(x); }\n');
    await write(
      "src/app.ts",
      'import { mid } from "./mid";\nexport function app(x) {\n  const secret = computeSecretThing(x);\n  return mid(secret);\n}\n'
    );

    const scan = await scanWorkspace(workspace);
    const neighbors = await findSourceGraphNeighbors(scan.files, new Set(["src/core.ts"]), []);
    const app = neighbors.find((n) => n.path === "src/app.ts");
    const mid = neighbors.find((n) => n.path === "src/mid.ts");
    assert.ok(app, "app.ts (2 hops) should be a neighbor");
    assert.equal(app.graph_distance, 2);
    assert.equal(app.compression, "signatures", "distant neighbor is compressed");
    assert.ok(!app.content.includes("computeSecretThing"), "body stripped from distant neighbor");
    assert.equal(mid.compression, "full", "direct (1-hop) neighbor keeps full content");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

// --- Ignore inheritance, budget auto-escalation, monorepo detection ---

test("compileIgnore/isIgnored honor dirs, globs, anchors, and negation", async () => {
  const { compileIgnore, isIgnored } = await import("../packages/engine/src/ignore.js");
  const rules = compileIgnore("build/\n*.log\n/secret.txt\n**/cache\n!keep.log\n");
  assert.equal(isIgnored("build/out.js", rules), true);
  assert.equal(isIgnored("src/app.log", rules), true);
  assert.equal(isIgnored("keep.log", rules), false);
  assert.equal(isIgnored("secret.txt", rules), true);
  assert.equal(isIgnored("a/b/cache/x.js", rules), true);
  assert.equal(isIgnored("src/app.ts", rules), false);
});

test("scanWorkspace respects a .deltaignore file", async () => {
  await withWorkspace("cd-ignore-", {
    ".deltaignore": "generated/\n*.snap\n",
    "src/app.ts": "export const x = 1;\n",
    "src/app.snap": "snapshot data\n",
    "generated/big.ts": "export const big = 1;\n"
  }, async (ws) => {
    const scan = await scanWorkspace(ws);
    const paths = scan.files.map((f) => f.path);
    assert.ok(paths.includes("src/app.ts"), "normal file kept");
    assert.ok(!paths.includes("src/app.snap"), "*.snap ignored");
    assert.ok(!paths.some((p) => p.startsWith("generated/")), "generated/ ignored");
  });
});

test("budget auto-escalates with change volume", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cd-budget-"));
  try {
    const write = async (rel, content) => {
      const full = path.join(workspace, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
    };
    for (let i = 0; i < 12; i += 1) await write(`src/mod${i}.ts`, `export const v${i} = ${i};\n`);
    const scan = await scanWorkspace(workspace);
    await writeSnapshot(workspace, scan.files);
    for (let i = 0; i < 12; i += 1) await fs.appendFile(path.join(workspace, `src/mod${i}.ts`), `export const extra${i} = ${i};\n`);

    const { packet } = await buildContextPacket({ task: "refactor modules", updateSnapshot: false, workspaceRoot: workspace });
    assert.equal(packet.budget.tier, "thorough", `12 changed files should escalate to thorough; got ${packet.budget.tier}`);
    assert.equal(packet.budget.auto_escalated, true);
    assert.ok(packet.budget.allocation && Number.isFinite(packet.budget.allocation.changed), "allocation present");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("monorepo layout is detected and surfaced", async () => {
  await withWorkspace("cd-mono-", {
    "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
    "packages/a/index.ts": "export const a = 1;\n"
  }, async (ws) => {
    const { packet } = await buildContextPacket({ task: "touch package a", updateSnapshot: false, workspaceRoot: ws });
    assert.equal(packet.workspace.monorepo.detected, true);
    assert.equal(packet.workspace.monorepo.tool, "pnpm");
  });
});

// --- Spec freshness: deprecated/superseded specs kept out of the packet (B3) ---

test("detectSpecStatus recognizes stale and active statuses", async () => {
  const { detectSpecStatus, isStaleStatus } = await import("../packages/engine/src/spec-freshness.js");
  assert.equal(detectSpecStatus("# Spec\n\nStatus: Superseded\n"), "superseded");
  assert.equal(detectSpecStatus("## Deprecated: old rule\n"), "deprecated");
  assert.equal(detectSpecStatus("This document is obsolete and no longer valid."), "deprecated");
  assert.equal(detectSpecStatus("Status: Accepted\n"), "accepted");
  assert.equal(detectSpecStatus("# Spec\n\nA normal requirement.\n"), null);
  assert.equal(isStaleStatus("superseded"), true);
  assert.equal(isStaleStatus("draft"), false);
  assert.equal(isStaleStatus("accepted"), false);
});

test("a deprecated spec is excluded from the packet with a reason and warning", async () => {
  await withWorkspace("cd-staleSpec-", {
    "specs/feature/spec.md": "# Feature Spec\n\nStatus: Accepted\n\n## Requirement: cap value at 50\n\nThe service must cap the value at 50.\n",
    "specs/feature/legacy.md": "# Feature Spec (legacy)\n\nStatus: Superseded\n\n## Requirement: no cap\n\nOld rule: the service allows uncapped values.\n",
    "src/service.ts": "export function cap(v) { return Math.min(v, 50); }\n",
    "AGENTS.md": "# Agent Instructions\n\nFollow the current spec, not superseded ones.\n"
  }, async (ws) => {
    const { packet } = await buildContextPacket({ task: "cap the service value at 50", updateSnapshot: false, workspaceRoot: ws });
    const includedSpecs = getUniqueIncludedItems(packet).filter((i) => i.type === "spec_section").map((i) => i.path);
    assert.ok(!includedSpecs.includes("specs/feature/legacy.md"), `superseded spec must not be included; got ${JSON.stringify(includedSpecs)}`);
    assert.ok(packet.spec_review.deprecated_specs.some((d) => d.path === "specs/feature/legacy.md" && d.status === "superseded"));
    assert.ok(packet.excluded.some((e) => e.path === "specs/feature/legacy.md" && /superseded/i.test(e.reason)));
    assert.ok(packet.warnings.some((w) => w.type === "stale-spec"));
  });
});

// --- Governance / compliance block + token ceiling (B6) ---

test("packet carries a compliance record and honors a token ceiling", async () => {
  await withWorkspace("cd-compliance-", {
    "src/app.ts": "export function run() { return 1; }\n",
    "AGENTS.md": "# Agent Instructions\n\nKeep it small.\n"
  }, async (ws) => {
    const { packet } = await buildContextPacket({ task: "run the app", updateSnapshot: false, workspaceRoot: ws });
    assert.ok(packet.compliance, "compliance block present");
    assert.equal(packet.compliance.within_token_ceiling, true);
    assert.equal(packet.compliance.violations.length, 0);
    assert.equal(packet.compliance.redact_secrets, true);
    assert.ok(Number.isFinite(packet.compliance.delivered_tokens));
  });
});

test("a delivered-token policy ceiling produces a violation and warning", async () => {
  await withWorkspace("cd-ceiling-", {
    "contextdelta.config.json": JSON.stringify({ policy: { maxDeliveredTokens: 5 } }),
    "src/app.ts": "export function run() { return computeSomethingLong(1, 2, 3); }\n",
    "specs/app/spec.md": "# App Spec\n\n## Requirement\n\nThe app must run and compute things.\n",
    "AGENTS.md": "# Agent Instructions\n\nFollow the spec.\n"
  }, async (ws) => {
    const { packet } = await buildContextPacket({ task: "run the app and compute things", updateSnapshot: false, workspaceRoot: ws });
    assert.equal(packet.compliance.max_delivered_tokens, 5);
    assert.equal(packet.compliance.within_token_ceiling, false, "delivered tokens should exceed a tiny ceiling");
    assert.ok(packet.compliance.violations.length >= 1);
    assert.ok(packet.warnings.some((w) => w.type === "policy-violation"));
  });
});

// --- Packet format contract (C4) ---

test("a freshly built packet satisfies the packet contract", async () => {
  const { validatePacket } = await import("../packages/engine/src/packet-schema.js");
  await withWorkspace("cd-schema-", {
    "src/auth/service.ts": "export function rotate(token) { return token; }\n",
    "tests/auth/service.test.ts": "import { rotate } from '../../src/auth/service';\ntest('rotate', () => { expect(rotate('a')).toBe('a'); });\n",
    "specs/auth/spec.md": "# Auth Spec\n\n## Requirement\n\nRotate tokens.\n",
    "AGENTS.md": "# Agent Instructions\n\nCover changes with tests.\n"
  }, async (ws) => {
    const { packet } = await buildContextPacket({ task: "rotate auth tokens", updateSnapshot: false, workspaceRoot: ws });
    const { valid, errors } = validatePacket(packet);
    assert.ok(valid, `packet should satisfy the contract; errors: ${JSON.stringify(errors)}`);
  });
});

test("validatePacket rejects a malformed packet", async () => {
  const { validatePacket } = await import("../packages/engine/src/packet-schema.js");
  const bad = validatePacket({ schema_version: "0.1" });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => e.includes("missing required field")));

  const inconsistent = validatePacket({
    schema_version: "0.1", id: "x", created_at: "now",
    intent: { task: "t", keywords: [] },
    changed_artifacts: [], supporting_evidence: [], governing_constraints: [], impacted_neighbors: [],
    excluded: [], warnings: [],
    budget: { target_tokens: 100, pressure: "low" },
    delivery: {}, controls: {}, spec_kit: {}, spec_review: {}, security: {},
    summary: { included_files_count: 0, excluded_files_count: 0 },
    workspace: { root: "/x" },
    compliance: { within_token_ceiling: true, violations: [] },
    metrics: { delivered_tokens_estimate: 5000, baseline_tokens_estimate: 100, context_reduction_percent: 50, packet_tokens_estimate: 10, token_count_method: "exact_tokenizer" }
  });
  assert.equal(inconsistent.valid, false, "delivered > baseline must be rejected");
  assert.ok(inconsistent.errors.some((e) => e.includes("exceeds baseline")));
});

// --- Robustness & performance: the engine must never crash, hang, or degrade ---

test("builds a valid packet for an empty workspace without throwing", async () => {
  const { validatePacket } = await import("../packages/engine/src/packet-schema.js");
  await withWorkspace("cd-empty-", { "README.md": "# Empty\n" }, async (ws) => {
    const { packet } = await buildContextPacket({ task: "do something", updateSnapshot: false, workspaceRoot: ws });
    assert.ok(validatePacket(packet).valid, "empty-workspace packet should still satisfy the contract");
    assert.ok(Array.isArray(packet.supporting_evidence), "sections present even when near-empty");
  });
});

test("tolerates binary, oversized, and extensionless files", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cd-weird-"));
  try {
    await fs.mkdir(path.join(workspace, "src"), { recursive: true });
    await fs.writeFile(path.join(workspace, "src/app.ts"), "export const x = 1;\n");
    await fs.writeFile(path.join(workspace, "src/blob.bin"), Buffer.from([0, 159, 146, 150, 0, 255, 254]));
    await fs.writeFile(path.join(workspace, "Makefile"), "all:\n\techo hi\n"); // no extension
    await fs.writeFile(path.join(workspace, "src/huge.ts"), `// big\n${"x".repeat(1_200_000)}\n`);
    const { packet } = await buildContextPacket({ task: "touch app", updateSnapshot: false, workspaceRoot: workspace });
    const included = getUniqueIncludedItems(packet).map((i) => i.path);
    assert.ok(!included.includes("src/blob.bin"), "binary file not delivered");
    assert.ok(!included.includes("src/huge.ts"), "oversized file not delivered");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("does not hang on a pathological minified line", async () => {
  const { buildRelevanceIndex } = await import("../packages/engine/src/relevance.js");
  const { extractSignatures } = await import("../packages/engine/src/compression.js");
  const huge = `export const data = {${"a:1,".repeat(50_000)}};\n`;
  const start = Date.now();
  await withWorkspace("cd-minified-", { "src/data.ts": huge, "src/app.ts": "export const y = 2;\n" }, async (ws) => {
    const scan = await scanWorkspace(ws);
    const index = await buildRelevanceIndex(scan.files);
    assert.ok(index.byPath.has("src/data.ts"));
    extractSignatures(huge, "src/data.ts"); // must return promptly
  });
  assert.ok(Date.now() - start < 5000, "indexing a minified file must not hang");
});

test("ignore matcher never throws on unusual patterns", async () => {
  const { compileIgnore, isIgnored } = await import("../packages/engine/src/ignore.js");
  const rules = compileIgnore("***\n[unclosed\n!!weird\n   \n#comment\n**/a/**/b\n");
  assert.doesNotThrow(() => isIgnored("a/x/b", rules));
  assert.doesNotThrow(() => isIgnored("", rules));
});

test("packet assembly stays within a generous time budget (regression guard)", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cd-perf-"));
  try {
    for (let i = 0; i < 200; i += 1) {
      const dir = path.join(workspace, "src", `m${i}`);
      await fs.mkdir(dir, { recursive: true });
      const dep = i > 0 ? `import { f${i - 1} } from "../m${i - 1}/s";\n` : "";
      await fs.writeFile(path.join(dir, "s.ts"), `${dep}export function f${i}(x){return x+${i};}\n`);
    }
    const start = Date.now();
    await buildContextPacket({ task: "update module multiply logic", updateSnapshot: false, workspaceRoot: workspace });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 8000, `assembly on 200 files took ${elapsed}ms (budget 8000ms) — possible algorithmic regression`);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

// --- Feedback flywheel: learn from drift misses to improve future packets (C2) ---

test("feedback boosts apply only to overlapping-keyword tasks", async () => {
  const { recordFeedback, loadFeedbackBoosts } = await import("../packages/engine/src/feedback.js");
  await withWorkspace("cd-fb-", { "README.md": "# x\n" }, async (ws) => {
    await recordFeedback(ws, { task: "add email retry to notifications", missedPaths: ["src/util/backoff.ts"] });
    const related = await loadFeedbackBoosts(ws, ["retry", "notifications", "email"]);
    assert.ok(related.has("src/util/backoff.ts"), "boost applies to a related task");
    const unrelated = await loadFeedbackBoosts(ws, ["pricing", "discount", "invoice"]);
    assert.ok(!unrelated.has("src/util/backoff.ts"), "boost does not leak to unrelated tasks");
    const optedOut = await loadFeedbackBoosts(ws, ["retry"], { enabled: false });
    assert.equal(optedOut.size, 0, "opt-out disables boosts");
  });
});

test("a recorded drift miss is surfaced in a later similar packet", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cd-fb-e2e-"));
  try {
    const write = async (rel, content) => {
      const full = path.join(workspace, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
    };
    await write("src/notifications/service.ts", "export function notify() { return 1; }\n");
    await write("src/util/backoff.ts", "export function wait(ms) { return ms; }\n");
    await write("AGENTS.md", "# Agent Instructions\n");
    const scan = await scanWorkspace(workspace);
    await writeSnapshot(workspace, scan.files);

    const before = getUniqueIncludedItems(
      (await buildContextPacket({ task: "add email retry to notifications", updateSnapshot: false, workspaceRoot: workspace })).packet
    ).map((i) => i.path);
    assert.ok(!before.includes("src/util/backoff.ts"), "baseline does not include the unrelated-by-name file");

    const { recordFeedback } = await import("../packages/engine/src/feedback.js");
    await recordFeedback(workspace, { task: "add email retry to notifications", missedPaths: ["src/util/backoff.ts"] });

    const after = getUniqueIncludedItems(
      (await buildContextPacket({ task: "add retry to notifications service", updateSnapshot: false, workspaceRoot: workspace })).packet
    );
    const item = after.find((i) => i.path === "src/util/backoff.ts");
    assert.ok(item, "after feedback, the previously-missed file is included");
    assert.match(item.reason, /learned from drift feedback/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

// --- Loop compaction: incremental handoff must never retain stale content (C5) ---

test("incremental handoff re-sends changed content instead of retaining it", () => {
  const mk = (path, content) => ({
    changed_artifacts: [{ type: "file_snapshot", path, content }],
    supporting_evidence: [],
    governing_constraints: [],
    impacted_neighbors: []
  });
  const previous = mk("src/a.ts", "version one content");

  const unchanged = buildIncrementalHandoffModel(mk("src/a.ts", "version one content"), previous);
  assert.equal(unchanged.retained.length, 1, "identical content is retained (not re-sent)");
  assert.equal(unchanged.new_buckets.length, 0);

  const changed = buildIncrementalHandoffModel(mk("src/a.ts", "version TWO different content"), previous);
  assert.ok(
    changed.new_buckets.some((b) => b.items.some((i) => i.path === "src/a.ts")),
    "changed content is re-sent as new"
  );
  assert.equal(changed.retained.length, 0, "changed content is not falsely retained");
  assert.equal(changed.removed.length, 0, "a content change is an update, not a removal");

  const dropped = buildIncrementalHandoffModel(mk("src/b.ts", "new file"), previous);
  assert.ok(dropped.removed.some((i) => i.path === "src/a.ts"), "a genuinely dropped file is removed");
});

// --- Context contracts: required context is verified at build time (C3) ---

test("a context contract reports satisfied and missing required patterns", async () => {
  await withWorkspace("cd-contract-", {
    "contextdelta.config.json": JSON.stringify({ contract: { require: ["src/auth/**", "tests/**"] } }),
    "src/auth/service.ts": "export function rotate(token) { return token; }\n",
    "AGENTS.md": "# Agent Instructions\n"
  }, async (ws) => {
    const { packet } = await buildContextPacket({ task: "rotate the auth token service", updateSnapshot: false, workspaceRoot: ws });
    const contract = packet.compliance.contract;
    assert.ok(contract.satisfied.includes("src/auth/**"), "auth pattern satisfied");
    assert.ok(contract.missing.includes("tests/**"), "tests pattern missing (no tests present)");
    assert.ok(packet.warnings.some((w) => w.type === "contract-violation"));
  });
});

test("a fully satisfied contract produces no violation", async () => {
  await withWorkspace("cd-contract-ok-", {
    "contextdelta.config.json": JSON.stringify({ contract: { require: ["src/auth/service.ts"] } }),
    "src/auth/service.ts": "export function rotate(token) { return token; }\n",
    "tests/auth.test.ts": "import { rotate } from '../src/auth/service';\ntest('r', () => { expect(rotate('a')).toBe('a'); });\n",
    "AGENTS.md": "# Agent Instructions\n"
  }, async (ws) => {
    const { packet } = await buildContextPacket({ task: "rotate the auth token service", updateSnapshot: false, workspaceRoot: ws });
    assert.equal(packet.compliance.contract.missing.length, 0);
    assert.ok(!packet.warnings.some((w) => w.type === "contract-violation"));
  });
});
