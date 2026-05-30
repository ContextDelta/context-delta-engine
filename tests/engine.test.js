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

const execFileAsync = promisify(execFile);

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
