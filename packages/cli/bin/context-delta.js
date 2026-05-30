#!/usr/bin/env node

import path from "node:path";
import { watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  buildPacketDiff,
  buildCompactPacketView,
  buildContextPacket,
  buildPacketInsights,
  applySetupFixes,
  cleanupStaleControls,
  getSupportedHandoffFormats,
  getGitState,
  getSetupStatus,
  inferWorkspaceIntent,
  listPacketHistory,
  loadConfig,
  readMetricsSummary,
  readPacketByIdOrPath,
  readPreviousPacket,
  renderReplayPrompt,
  renderContextDriftMarkdown,
  renderRiskHeader,
  renderSetupMarkdown,
  reviewContextDrift,
  runPacketEval,
  renderHandoff,
  renderPacketDiffMarkdown,
  scanWorkspace,
  syncInstructionFiles,
  writePacketApproval,
  writeManagerSummary,
  writeDefaultConfig,
  writeHtmlReport,
  writePacketAndMetrics,
  writeSnapshot
} from "../../engine/src/index.js";
import { formatPercent } from "../../shared/src/index.js";

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("-") ? args.shift() : "help";

try {
  if (command === "prepare") {
    await runPrepare(args);
  } else if (command === "packet") {
    await runPacket(args);
  } else if (command === "scan") {
    await runScan(args);
  } else if (command === "snapshot") {
    await runSnapshot(args);
  } else if (command === "metrics") {
    await runMetrics(args);
  } else if (command === "report") {
    await runReport(args);
  } else if (command === "insights") {
    await runInsights(args);
  } else if (command === "compact") {
    await runCompact(args);
  } else if (command === "controls") {
    await runControls(args);
  } else if (command === "history") {
    await runHistory(args);
  } else if (command === "diff") {
    await runDiff(args);
  } else if (command === "inject") {
    await runInject(args);
  } else if (command === "watch") {
    await runWatch(args);
  } else if (command === "handoff") {
    await runHandoff(args);
  } else if (command === "summary") {
    await runSummary(args);
  } else if (command === "drift") {
    await runDrift(args);
  } else if (command === "eval") {
    await runEval(args);
  } else if (command === "approve") {
    await runApprove(args);
  } else if (command === "replay") {
    await runReplay(args);
  } else if (command === "init") {
    await runInit(args);
  } else if (command === "doctor") {
    await runDoctor(args);
  } else if (command === "setup") {
    await runSetup(args);
  } else {
    printHelp();
  }
} catch (error) {
  console.error(`Context Delta error: ${error.message}`);
  process.exitCode = 1;
}

async function runPacket(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const task = parsed.positionals.join(" ").trim();
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const json = parsed.flags.has("json");
  const noWrite = parsed.flags.has("no-write") || parsed.flags.has("dry-run");
  const noSnapshot = parsed.flags.has("no-snapshot");
  const report = parsed.flags.has("report");

  if (!task) {
    throw new Error('packet requires a task, for example: context-delta packet "fix auth tests"');
  }

  const { packet } = await buildContextPacket({
    exclude: parsed.options.exclude ?? [],
    limits: parseLimits(parsed.options),
    mode: parsed.options.mode,
    model: parsed.options.model,
    pin: parsed.options.pin ?? [],
    task,
    updateSnapshot: !noSnapshot && !noWrite,
    workspaceRoot
  });

  let outputPaths = null;
  if (!noWrite) {
    outputPaths = await writePacketAndMetrics(workspaceRoot, packet);
    if (report) {
      outputPaths.reportPath = await writeHtmlReport(workspaceRoot, packet);
    }
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          compact_view: parsed.flags.has("compact") ? packet.compact_view : undefined,
          output_paths: outputPaths,
          packet
        },
        null,
        2
      )
    );
    return;
  }

  printPacketSummary(packet, outputPaths);
}

async function runPrepare(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const explicitTask = parsed.positionals.join(" ").trim();
  const task = explicitTask || (await inferWorkspaceIntent(workspaceRoot));
  const format = parsed.options.format ?? "markdown";
  const noWrite = parsed.flags.has("no-write") || parsed.flags.has("dry-run");

  if (!getSupportedHandoffFormats().includes(format) || ["compact", "json", "replay"].includes(format)) {
    throw new Error("prepare supports prompt-ready formats: markdown, copilot, spec-kit");
  }

  const { packet } = await buildContextPacket({
    exclude: parsed.options.exclude ?? [],
    limits: parseLimits(parsed.options),
    mode: parsed.options.mode,
    model: parsed.options.model,
    pin: parsed.options.pin ?? [],
    target: "local-prepare",
    task,
    updateSnapshot: !noWrite,
    workspaceRoot
  });
  const outputPaths = noWrite ? null : await writePacketAndMetrics(workspaceRoot, packet);
  const riskHeader = renderRiskHeader(packet);
  const handoff = renderHandoff(packet, { format });

  if (parsed.flags.has("json")) {
    console.log(
      JSON.stringify(
        {
          format,
          inferred_task: !explicitTask,
          output_paths: outputPaths,
          packet_id: packet.id,
          risk_header: riskHeader,
          task
        },
        null,
        2
      )
    );
    return;
  }

  console.log("# Context Delta Prepared Context");
  console.log("");
  console.log(riskHeader);
  console.log("");
  console.log("Use this handoff as the focused working context. Inspect the full packet only if the risk header or agent result requires it.");
  console.log("");
  process.stdout.write(handoff);
}

async function prepareAndInject(workspaceRoot, parsed, explicitTask) {
  const task = explicitTask || (await inferWorkspaceIntent(workspaceRoot));
  const config = await loadConfig(workspaceRoot);
  // Keep the instruction files we write out of their own packet, so the digest
  // never lists itself as a changed file or rule.
  const injectTargets = config.inject?.targets ?? [];
  const exclude = [...new Set([...(parsed.options.exclude ?? []), ...injectTargets])];
  const { packet } = await buildContextPacket({
    exclude,
    limits: parseLimits(parsed.options),
    mode: parsed.options.mode,
    pin: parsed.options.pin ?? [],
    target: "instruction-inject",
    task,
    updateSnapshot: true,
    workspaceRoot
  });
  await writePacketAndMetrics(workspaceRoot, packet);
  const sync = await syncInstructionFiles(workspaceRoot, packet, config);
  return { packet, sync, task };
}

async function runInject(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const explicitTask = parsed.positionals.join(" ").trim();
  const { packet, sync, task } = await prepareAndInject(workspaceRoot, parsed, explicitTask);

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify({ task, packet_id: packet.id, inject: sync }, null, 2));
    return;
  }

  if (sync.enabled === false) {
    console.log("Context Delta injection is disabled in config (inject.enabled = false).");
    return;
  }

  const wasted = packet.metrics.wasted_tokens_estimate ?? 0;
  console.log(`Context Delta updated agent instructions for: ${task}`);
  console.log(`Wasted context avoided: ${wasted} tokens (${formatPercent(packet.metrics.context_reduction_percent)})`);
  for (const result of sync.results) {
    const state = result.changed ? (result.created ? "created" : "updated") : "unchanged";
    console.log(`- ${result.target}: ${state}`);
  }
  console.log("Your agent (e.g. GitHub Copilot) will pick this up automatically on its next request.");
}

async function runWatch(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const explicitTask = parsed.positionals.join(" ").trim();
  const debounceMs = Number(parsed.options.debounce ?? 800);
  const config = await loadConfig(workspaceRoot);
  const targets = new Set((config.inject?.targets ?? []).map((target) => path.resolve(workspaceRoot, target)));

  function isIgnored(filename) {
    if (!filename) return false;
    const normalized = filename.replaceAll("\\", "/");
    if (/(^|\/)(\.git|node_modules|\.contextdelta)(\/|$)/.test(normalized)) return true;
    // Ignore the instruction files we write ourselves, to avoid feedback loops.
    return targets.has(path.resolve(workspaceRoot, normalized));
  }

  async function runOnce(reason) {
    try {
      const { packet, sync, task } = await prepareAndInject(workspaceRoot, parsed, explicitTask);
      const changed = sync.results?.filter((result) => result.changed).map((result) => result.target) ?? [];
      const stamp = new Date().toLocaleTimeString();
      const wasted = packet.metrics.wasted_tokens_estimate ?? 0;
      console.log(
        `[${stamp}] ${reason} -> ${task} · ${wasted} wasted tokens avoided (${formatPercent(packet.metrics.context_reduction_percent)})` +
          (changed.length ? ` · updated: ${changed.join(", ")}` : " · no change")
      );
    } catch (error) {
      console.error(`[watch] ${error.message}`);
    }
  }

  console.log(`Context Delta is watching ${workspaceRoot}`);
  console.log("It keeps your agent instruction files scoped to what you are working on. Press Ctrl+C to stop.");
  await runOnce("initial");

  let timer = null;
  let watcher;
  try {
    watcher = watch(workspaceRoot, { recursive: true }, (_event, filename) => {
      if (isIgnored(filename)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => runOnce("change"), debounceMs);
    });
  } catch {
    console.error("Recursive watch is not supported on this platform; run `context-delta inject` after changes instead.");
    return;
  }

  await new Promise((resolve) => {
    process.on("SIGINT", () => {
      watcher.close();
      console.log("\nContext Delta watch stopped.");
      resolve();
    });
  });
}

async function runScan(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const scan = await scanWorkspace(workspaceRoot);

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify(scan, null, 2));
    return;
  }

  const counts = countBy(scan.files, "kind");
  console.log("Context Delta workspace scan");
  console.log("");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Files scanned: ${scan.files.length}`);
  for (const [kind, count] of Object.entries(counts).sort()) {
    console.log(`- ${kind}: ${count}`);
  }
}

async function runSnapshot(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const scan = await scanWorkspace(workspaceRoot);
  const snapshot = await writeSnapshot(workspaceRoot, scan.files);

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  console.log("Context Delta snapshot written");
  console.log("");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Files tracked: ${Object.keys(snapshot.files).length}`);
}

async function runMetrics(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const summary = await readMetricsSummary(workspaceRoot, {
    since: parsed.options.since,
    limit: parsed.options.limit
  });

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("Context Delta metrics summary");
  console.log("");
  console.log(`Sessions: ${summary.sessions}`);
  console.log(`Estimated tokens saved: ${summary.tokens_saved_estimate}`);
  console.log(
    `Average context reduction: ${formatPercent(summary.average_context_reduction_percent)}`
  );
  console.log(`Average packet size: ${summary.average_packet_tokens_estimate} tokens`);
  console.log(`Packet expansions: ${summary.packet_expansions}`);
  console.log(`Stale spec warnings: ${summary.stale_spec_warnings}`);
  console.log(`Risk mix: ${formatCounts(summary.risk_counts)}`);
  console.log(`Budget mix: ${formatCounts(summary.budget_pressure_counts)}`);
  console.log(`Redactions applied: ${summary.redactions_applied}`);
}

async function runReport(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const task = parsed.positionals.join(" ").trim() || "Generate Context Delta report";
  const latestPacketPath = path.join(workspaceRoot, ".contextdelta", "packets", "latest.json");

  let packet;
  try {
    const raw = await readFile(latestPacketPath, "utf8");
    packet = JSON.parse(raw);
  } catch {
    packet = (
      await buildContextPacket({
        exclude: parsed.options.exclude ?? [],
        limits: parseLimits(parsed.options),
        mode: parsed.options.mode,
        pin: parsed.options.pin ?? [],
        task,
        updateSnapshot: false,
        workspaceRoot
      })
    ).packet;
  }

  const reportPath = await writeHtmlReport(workspaceRoot, packet);
  if (parsed.flags.has("json")) {
    console.log(JSON.stringify({ report_path: reportPath }, null, 2));
    return;
  }

  console.log("Context Delta report written");
  console.log("");
  console.log(`Report: ${path.relative(process.cwd(), reportPath)}`);
}

async function runInsights(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const packet = await readLatestPacket(workspaceRoot);
  const insights = packet.insights ?? buildPacketInsights(packet);

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify(insights, null, 2));
    return;
  }

  console.log("Context Delta insights");
  console.log("");
  console.log(insights.headline);
  console.log(`Risk: ${insights.risk_level}`);
  console.log("");
  console.log("Signals:");
  for (const card of insights.cards ?? []) {
    console.log(`- ${card.title}: ${card.body}`);
  }
  console.log("");
  console.log("Recommendations:");
  for (const recommendation of insights.recommendations ?? []) {
    console.log(`- ${recommendation}`);
  }
}

async function runCompact(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const packet = await readLatestPacket(workspaceRoot);
  const compactView = packet.compact_view ?? buildCompactPacketView(packet);

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify(compactView, null, 2));
    return;
  }

  console.log("Context Delta compact packet");
  console.log("");
  console.log(`Task: ${compactView.intent.task}`);
  console.log(`Headline: ${compactView.insights?.headline ?? "No insights available"}`);
  console.log(`Risk: ${compactView.insights?.risk_level ?? "unknown"}`);
  console.log(`Budget: ${compactView.budget.pressure ?? "unknown"}`);
  console.log(`Included: ${compactView.included.length}`);
  console.log("");
  for (const item of compactView.included.slice(0, 12)) {
    console.log(`- ${item.path}${item.heading ? `#${item.heading}` : ""}`);
    console.log(`  ${item.reason}`);
  }
}

async function runControls(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");

  if (!parsed.flags.has("cleanup-stale")) {
    throw new Error("controls currently supports --cleanup-stale.");
  }

  const result = await cleanupStaleControls(workspaceRoot);

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Context Delta controls cleanup");
  console.log("");
  console.log(`Config: ${path.relative(process.cwd(), result.config_path)}`);
  console.log(`Removed stale controls: ${result.removed_count}`);
  if (result.removed.length) {
    console.log("");
    for (const item of result.removed) {
      console.log(`- ${item}`);
    }
  }
}

async function runHistory(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const history = await listPacketHistory(workspaceRoot, {
    limit: Number(parsed.options.limit ?? 20)
  });

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify({ history }, null, 2));
    return;
  }

  console.log("Context Delta packet history");
  console.log("");
  if (!history.length) {
    console.log("No historical packets found.");
    return;
  }

  for (const packet of history) {
    console.log(`- ${packet.id} ${packet.created_at}`);
    console.log(`  Task: ${packet.task}`);
    console.log(
      `  Risk: ${packet.risk_level}, Included: ${packet.summary?.included_files_count ?? 0}, Saved: ${packet.metrics?.tokens_saved_estimate ?? 0} tokens`
    );
  }
}

async function runDiff(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const current = parsed.options.to
    ? await readPacketByIdOrPath(workspaceRoot, parsed.options.to)
    : await readLatestPacket(workspaceRoot);
  const previous = parsed.options.from
    ? await readPacketByIdOrPath(workspaceRoot, parsed.options.from)
    : await readPreviousPacket(workspaceRoot, current.id);

  if (!previous) {
    throw new Error("No previous packet found to diff against.");
  }

  const diff = buildPacketDiff(previous, current);
  const format = parsed.options.format ?? (parsed.flags.has("json") ? "json" : "markdown");
  const output = format === "json" ? `${JSON.stringify(diff, null, 2)}\n` : `${renderPacketDiffMarkdown(diff)}\n`;

  if (parsed.options.output) {
    const outputPath = path.resolve(workspaceRoot, parsed.options.output);
    await writeFile(outputPath, output);
    console.log(`Diff written: ${path.relative(process.cwd(), outputPath)}`);
    return;
  }

  process.stdout.write(output);
}

async function runHandoff(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const packet = await readLatestPacket(workspaceRoot);
  const format = parsed.options.format ?? "markdown";

  if (!getSupportedHandoffFormats().includes(format)) {
    throw new Error(`Unsupported handoff format '${format}'. Use: ${getSupportedHandoffFormats().join(", ")}`);
  }

  const renderOptions = { format };
  if (format === "incremental" || format === "delta") {
    renderOptions.previousPacket = parsed.options.from
      ? await readPacketByIdOrPath(workspaceRoot, parsed.options.from)
      : await readPreviousPacket(workspaceRoot, packet.id);
  }

  const output = renderHandoff(packet, renderOptions);
  if (parsed.options.output) {
    const outputPath = path.resolve(workspaceRoot, parsed.options.output);
    await writeFile(outputPath, output);
    console.log(`Handoff written: ${path.relative(process.cwd(), outputPath)}`);
    return;
  }

  process.stdout.write(output);
}

async function runSummary(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const result = await writeManagerSummary(workspaceRoot, {
    label: parsed.options.label,
    since: parsed.options.since
  });

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify(result.summary, null, 2));
    return;
  }

  console.log("Context Delta manager summary written");
  console.log("");
  console.log(`Markdown: ${path.relative(process.cwd(), result.markdownPath)}`);
  console.log(`JSON: ${path.relative(process.cwd(), result.jsonPath)}`);
}

async function runDrift(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const review = await reviewContextDrift(workspaceRoot);

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify(review, null, 2));
    return;
  }

  process.stdout.write(`${renderContextDriftMarkdown(review)}\n`);
}

async function runEval(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const result = await runPacketEval(workspaceRoot, {
    casesPath: parsed.options.cases,
    writeOutputs: !parsed.flags.has("dry-run") && !parsed.flags.has("no-write")
  });
  const summary = result.report.summary;

  if (parsed.flags.has("fail-on-failure") && summary.passed < summary.cases) {
    process.exitCode = 1;
  }

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Context Delta packet-quality eval");
  console.log("");
  console.log(`Cases: ${summary.cases}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Pass rate: ${formatPercent(summary.pass_rate_percent)}`);
  console.log(
    `Useful-context density: ${formatPercent(summary.average_useful_context_density_percent)}`
  );
  console.log(`Impact coverage: ${formatPercent(summary.average_impact_coverage_percent)}`);
  console.log(`Omission rate: ${formatPercent(summary.average_omission_rate_percent)}`);
  if (result.output_paths) {
    console.log("");
    console.log(`Eval JSON: ${path.relative(process.cwd(), result.output_paths.jsonPath)}`);
    console.log(`Eval Markdown: ${path.relative(process.cwd(), result.output_paths.markdownPath)}`);
  }
}

async function runApprove(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const packet = await readLatestPacket(workspaceRoot);
  const result = await writePacketApproval(workspaceRoot, packet, {
    decision: parsed.options.decision ?? "approved",
    notes: parsed.options.notes ?? ""
  });

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Context Delta packet review recorded");
  console.log("");
  console.log(`Decision: ${result.approval.decision}`);
  console.log(`Packet: ${result.approval.packet_id}`);
  console.log(`Approval: ${path.relative(process.cwd(), result.latestPath)}`);
}

async function runReplay(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const packet = await readLatestPacket(workspaceRoot);
  const output = renderReplayPrompt(packet);

  if (parsed.options.output) {
    const outputPath = path.resolve(workspaceRoot, parsed.options.output);
    await writeFile(outputPath, output);
    console.log(`Replay prompt written: ${path.relative(process.cwd(), outputPath)}`);
    return;
  }

  process.stdout.write(output);
}

async function runInit(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const result = await writeDefaultConfig(workspaceRoot, {
    force: parsed.flags.has("force")
  });

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(result.created ? "Context Delta config created" : "Context Delta config already exists");
  console.log("");
  console.log(`Config: ${path.relative(process.cwd(), result.path)}`);
}

async function runDoctor(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const scan = await scanWorkspace(workspaceRoot);
  const git = await getGitState(workspaceRoot);
  const config = await loadConfig(workspaceRoot);
  const counts = countBy(scan.files, "kind");
  const mcpCommand = `${process.execPath} ${path.resolve("packages/mcp-server/bin/context-delta-mcp.js")}`;

  console.log("Context Delta doctor");
  console.log("");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Mode: ${config.mode}`);
  console.log(`Git: ${git.available ? `yes (${git.branch ?? "unknown"})` : "no"}`);
  console.log(`Files scanned: ${scan.files.length}`);
  console.log(`Specs: ${counts.spec ?? 0}`);
  console.log(`Instructions: ${counts.instruction ?? 0}`);
  console.log(`Tests: ${counts.test ?? 0}`);
  console.log(`Source files: ${counts.source ?? 0}`);
  console.log(`Policy exclusions: ${config.policy.excludePaths.length}`);
  console.log(`Pinned paths: ${config.controls.pin.length}`);
  console.log("");
  console.log("Status: ready");

  if (parsed.flags.has("mcp")) {
    console.log("");
    console.log("MCP setup");
    console.log("");
    console.log("Primary tool: prepare_context");
    console.log("Use prepare_context before coding, reviewing, or debugging. It returns a handoff plus a one-line risk header.");
    console.log("");
    console.log("Server command:");
    console.log("");
    console.log(`  ${mcpCommand}`);
    console.log("");
    console.log("Generic MCP config:");
    console.log("");
    console.log(JSON.stringify(buildMcpConfig(workspaceRoot), null, 2));
    console.log("");
    console.log("Claude Code / Claude Desktop:");
    console.log("Paste the same command/args into the host's MCP server config. Set CONTEXT_DELTA_WORKSPACE to this repo if the host does not pass workspaceRoot.");
    console.log("");
    console.log("GitHub Copilot:");
    console.log("Use the VS Code extension handoff flow for now; direct MCP/tool integration depends on Copilot host support.");
  }
}

async function runSetup(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const workspaceRoot = path.resolve(parsed.options.workspace ?? ".");
  const target = parsed.options.target ?? "all";
  const result = parsed.flags.has("fix")
    ? await applySetupFixes(workspaceRoot, { target })
    : { status: await getSetupStatus(workspaceRoot, { target }) };

  if (parsed.flags.has("json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.actions) {
    console.log("Context Delta setup fixes");
    console.log("");
    for (const action of result.actions) {
      console.log(`- ${action.changed ? "updated" : "checked"} ${action.type}: ${action.message}`);
    }
    console.log("");
  }

  process.stdout.write(renderSetupMarkdown(result.status));
}

function buildMcpConfig(workspaceRoot) {
  return {
    mcpServers: {
      "context-delta": {
        command: process.execPath,
        args: [path.resolve("packages/mcp-server/bin/context-delta-mcp.js")],
        env: {
          CONTEXT_DELTA_WORKSPACE: workspaceRoot
        }
      }
    }
  };
}

function parseArgs(rawArgs) {
  const flags = new Set();
  const options = {};
  const positionals = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--workspace" || arg === "-w") {
      options.workspace = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (
      [
        "--mode",
        "--model",
        "--pin",
        "--exclude",
        "--budget",
        "--snippet-chars",
        "--target-tokens",
        "--changed",
        "--impacted",
        "--instructions",
        "--markdown-sections",
        "--tests",
        "--format",
        "--target",
        "--output",
        "--limit",
        "--from",
        "--to",
        "--since",
        "--label",
        "--cases",
        "--decision",
        "--notes",
        "--debounce"
      ].includes(arg)
    ) {
      const key = arg.slice(2).replaceAll("-", "_");
      const value = rawArgs[index + 1];
      if (key === "pin" || key === "exclude") {
        options[key] = [...(options[key] ?? []), value];
      } else {
        options[key] = value;
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      flags.add(arg.slice(2));
      continue;
    }

    positionals.push(arg);
  }

  return { flags, options, positionals };
}

function printPacketSummary(packet, outputPaths) {
  console.log("Context Packet Ready");
  console.log("");
  console.log(`Task: ${packet.intent.task}`);
  console.log(`Strategy: ${packet.workspace.git.strategy}`);
  console.log(`Changed files: ${packet.summary.changed_files_count}`);
  console.log(`Related tests: ${packet.summary.included_tests_count}`);
  console.log(`Relevant specs: ${packet.summary.included_spec_units_count}`);
  console.log(`Rules/instructions: ${packet.governing_constraints.length}`);
  console.log(`Excluded noisy files: ${packet.summary.excluded_files_count}`);
  console.log(
    `Naive agent context: ~${packet.metrics.baseline_tokens_estimate} tokens -> Context Delta: ~${packet.metrics.delivered_tokens_estimate} tokens`
  );
  console.log(
    `Estimated wasted context avoided: ${packet.metrics.wasted_tokens_estimate} tokens (${formatPercent(packet.metrics.context_reduction_percent)})`
  );
  console.log(
    `Useful-context density: ${formatPercent(packet.metrics.heuristic_useful_context_density_percent)}`
  );
  console.log(`Budget pressure: ${packet.budget?.pressure ?? "unknown"}`);
  if (packet.insights?.headline) {
    console.log(`Insight: ${packet.insights.headline}`);
  }

  if (packet.warnings.length) {
    console.log("");
    console.log("Warnings:");
    for (const warning of packet.warnings) {
      console.log(`- ${warning.message}`);
    }
  }

  console.log("");
  console.log("Included:");
  for (const item of [
    ...packet.changed_artifacts,
    ...packet.supporting_evidence,
    ...packet.governing_constraints,
    ...packet.impacted_neighbors
  ].slice(0, 12)) {
    console.log(`- ${item.path}${item.heading ? `#${item.heading}` : ""}`);
    console.log(`  ${item.reason}`);
  }

  if (outputPaths) {
    console.log("");
    console.log(`Packet: ${path.relative(process.cwd(), outputPaths.latestPath)}`);
    console.log(`Metrics: ${path.relative(process.cwd(), outputPaths.metricsPath)}`);
    if (outputPaths.reportPath) {
      console.log(`Report: ${path.relative(process.cwd(), outputPaths.reportPath)}`);
    }
  }
}

async function readLatestPacket(workspaceRoot) {
  const latestPacketPath = path.join(workspaceRoot, ".contextdelta", "packets", "latest.json");
  const raw = await readFile(latestPacketPath, "utf8");
  return JSON.parse(raw);
}

function parseLimits(options) {
  const limits = {};
  const numericOptions = {
    changed: "changed",
    impacted: "impacted",
    instructions: "instructions",
    markdown_sections: "markdownSections",
    tests: "tests"
  };

  for (const [optionKey, limitKey] of Object.entries(numericOptions)) {
    if (options[optionKey]) {
      limits[limitKey] = Number(options[optionKey]);
    }
  }

  if (options.budget) {
    limits.snippetChars = Number(options.budget);
  }
  if (options.snippet_chars) {
    limits.snippetChars = Number(options.snippet_chars);
  }
  if (options.target_tokens) {
    limits.targetTokens = Number(options.target_tokens);
  }
  return Object.fromEntries(
    Object.entries(limits).filter(([, value]) => Number.isFinite(value) && value > 0)
  );
}

function countBy(items, key) {
  return items.reduce((accumulator, item) => {
    accumulator[item[key]] = (accumulator[item[key]] ?? 0) + 1;
    return accumulator;
  }, {});
}

function formatCounts(counts = {}) {
  const entries = Object.entries(counts);
  if (!entries.length) return "none";
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function printHelp() {
  console.log(`Context Delta

Usage:
  context-delta prepare ["task description"] [--workspace .] [--format markdown|copilot|spec-kit]
                         [--json] [--dry-run]
  context-delta packet "task description" [--workspace .] [--json] [--compact] [--dry-run]
                       [--mode balanced|conservative|strict] [--model gpt-4o|gpt-4|...] [--pin path] [--exclude path]
                       [--changed n] [--markdown-sections n] [--snippet-chars n] [--target-tokens n]
  context-delta scan [--workspace .] [--json]
  context-delta snapshot [--workspace .] [--json]
  context-delta metrics [--workspace .] [--json]
  context-delta report [--workspace .] [--json]
  context-delta insights [--workspace .] [--json]
  context-delta compact [--workspace .] [--json]
  context-delta controls [--workspace .] --cleanup-stale [--json]
  context-delta history [--workspace .] [--json]
  context-delta diff [--workspace .] [--json] [--from packet] [--to packet]
  context-delta drift [--workspace .] [--json]
  context-delta handoff [--workspace .] [--format markdown|copilot|spec-kit|incremental|compact|json] [--from packet]
  context-delta inject ["task description"] [--workspace .] [--json]
  context-delta watch ["task description"] [--workspace .] [--debounce ms]
  context-delta summary [--workspace .] [--json]
  context-delta eval [--workspace .] [--cases path] [--json] [--fail-on-failure]
  context-delta approve [--workspace .] [--decision approved|needs-expansion] [--json]
  context-delta replay [--workspace .] [--output path]
  context-delta init [--workspace .] [--force]
  context-delta doctor [--workspace .] [--mcp]
  context-delta setup [--workspace .] [--fix] [--json]

Commands:
  prepare   Build context and print an agent-ready handoff with a risk header
  packet    Build a context packet for an AI coding task
  scan      Scan the workspace and classify files
  snapshot  Write a local snapshot for no-git delta detection
  metrics   Show local privacy-safe metrics summary
  report    Generate a local HTML report from the latest packet
  insights  Explain packet quality, risks, and next actions
  compact   Print a content-free packet preview for quick review
  controls  Clean stale manual pin/exclude controls
  history   Show recent local packet history
  diff      Show previous vs current packet changes
  drift     Review current edits against the latest packet
  handoff   Render a prompt-ready packet for an agent
  inject    Write a scoped context digest into agent instruction files (copilot-instructions.md, AGENTS.md)
  watch     Keep agent instruction files continuously scoped as you edit
  summary   Write manager-friendly repo metrics summary
  eval      Score packets against a labeled gold set
  approve   Record a local packet review decision
  replay    Render a packet replay prompt
  init      Write contextdelta.config.json
  doctor    Check whether the workspace is ready; add --mcp for setup snippets
  setup     Check or fix first-run setup for VS Code, MCP, and local config
`);
}
