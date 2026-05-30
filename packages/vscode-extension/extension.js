const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const vscode = require("vscode");

let dashboardProvider = null;
let statusBarItem = null;
const PREFERRED_AGENT_KEY = "contextDelta.preferredAgent";

const PACKET_PRESETS = [
  {
    label: "Code review",
    description: "Review changed code for bugs, regressions, and missing tests",
    mode: "balanced",
    task: "Review the current code changes for bugs, regressions, and missing tests."
  },
  {
    label: "Docs/content review",
    description: "Review docs, site, README, or content changes",
    mode: "balanced",
    task: "Review the current documentation and content changes for clarity, broken links, stale instructions, and layout issues.",
    limits: {
      changed: 8,
      markdownSections: 8,
      snippetChars: 6000,
      targetTokens: 12000
    }
  },
  {
    label: "Test/debug",
    description: "Debug failing tests or test-related changes",
    mode: "conservative",
    task: "Debug the current test-related changes and identify likely failures or missing coverage.",
    limits: {
      tests: 12,
      changed: 10,
      targetTokens: 14000
    }
  },
  {
    label: "Spec-driven change",
    description: "Start from a spec/change task and let Context Delta rank supporting files",
    mode: "conservative",
    task: "Review the current implementation against the relevant specs, tasks, and acceptance criteria.",
    limits: {
      markdownSections: 12,
      tests: 10,
      targetTokens: 14000
    }
  },
  {
    label: "Security-sensitive",
    description: "Prioritize instructions, tests, and security-related context",
    mode: "conservative",
    task: "Review the current security-sensitive changes for unsafe behavior, missing tests, and policy violations.",
    limits: {
      instructions: 10,
      tests: 10,
      targetTokens: 14000
    }
  },
  {
    label: "Custom task",
    description: "Type your own task and keep current controls",
    mode: "balanced",
    task: ""
  }
];

const AGENT_HANDOFFS = {
  claude: {
    command: "contextDelta.copyForClaude",
    format: "markdown",
    label: "Claude"
  },
  codex: {
    command: "contextDelta.copyForCodex",
    format: "markdown",
    label: "Codex"
  },
  copilot: {
    command: "contextDelta.copyForCopilot",
    format: "copilot",
    label: "Copilot"
  }
};

function activate(context) {
  dashboardProvider = new ContextDeltaDashboardProvider(context);
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "contextDelta.prepareCurrentChanges";
  statusBarItem.tooltip = "Context Delta: prepare context for your preferred agent";
  statusBarItem.text = "$(sync) Context Delta";
  statusBarItem.show();

  context.subscriptions.push(
    statusBarItem,
    vscode.window.registerWebviewViewProvider("contextDelta.dashboard", dashboardProvider),
    vscode.commands.registerCommand("contextDelta.createPacket", () => createPacket(context)),
    vscode.commands.registerCommand("contextDelta.showLatestPacket", () => showLatestPacket(context)),
    vscode.commands.registerCommand("contextDelta.writeSnapshot", () => writeSnapshot()),
    vscode.commands.registerCommand("contextDelta.showMetrics", () => showMetrics(context)),
    vscode.commands.registerCommand("contextDelta.writeConfig", () => writeConfig()),
    vscode.commands.registerCommand("contextDelta.generateReport", () => generateReport(context)),
    vscode.commands.registerCommand("contextDelta.showInsights", () => showInsights(context)),
    vscode.commands.registerCommand("contextDelta.showPacketDiff", () => showPacketDiff(context)),
    vscode.commands.registerCommand("contextDelta.generateManagerSummary", () => generateManagerSummary(context)),
    vscode.commands.registerCommand("contextDelta.showSetup", () => showSetup(context)),
    vscode.commands.registerCommand("contextDelta.fixSetup", () => fixSetup(context)),
    vscode.commands.registerCommand("contextDelta.showDrift", () => showDrift(context)),
    vscode.commands.registerCommand("contextDelta.chooseAgent", () => choosePreferredAgent(context)),
    vscode.commands.registerCommand("contextDelta.prepareCurrentChanges", () => prepareAndCopyForAgent(context, getPreferredAgent(context), { inferTask: true })),
    vscode.commands.registerCommand("contextDelta.copyLatestPacket", () => copyLatestPacket()),
    vscode.commands.registerCommand("contextDelta.copyCompactPacket", () => copyCompactPacket()),
    vscode.commands.registerCommand("contextDelta.copyAgentHandoff", () => copyAgentHandoff()),
    vscode.commands.registerCommand("contextDelta.copyForCodex", () => prepareAndCopyForAgent(context, "codex")),
    vscode.commands.registerCommand("contextDelta.copyForClaude", () => prepareAndCopyForAgent(context, "claude")),
    vscode.commands.registerCommand("contextDelta.copyForCopilot", () => prepareAndCopyForAgent(context, "copilot")),
    vscode.commands.registerCommand("contextDelta.copyReplayPrompt", () => copyReplayPrompt()),
    vscode.commands.registerCommand("contextDelta.approveLatestPacket", () => approveLatestPacket()),
    vscode.commands.registerCommand("contextDelta.includePath", () => addControlPathCommand("pin")),
    vscode.commands.registerCommand("contextDelta.excludePath", () => addControlPathCommand("exclude")),
    vscode.commands.registerCommand("contextDelta.tuneControls", () => tuneControls()),
    vscode.commands.registerCommand("contextDelta.cleanupControls", () => cleanupControlsCommand()),
    vscode.commands.registerCommand("contextDelta.clearControls", () => clearControlsCommand()),
    vscode.commands.registerCommand("contextDelta.refreshDashboard", () => refreshDashboard())
  );

  setupRealtimeWatch(context);
}

// Watches the packet artifact Context Delta writes, so the dashboard and status
// bar reflect new packets in real time — whether a VS Code command, the CLI, or
// an MCP client produced them. Debounced to coalesce rapid writes.
function setupRealtimeWatch(context) {
  if (!vscode.workspace.workspaceFolders?.length) return;
  const watcher = vscode.workspace.createFileSystemWatcher("**/.contextdelta/packets/latest.json");
  let timer = null;
  const scheduleRefresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => refreshDashboard(), 250);
  };
  watcher.onDidChange(scheduleRefresh);
  watcher.onDidCreate(scheduleRefresh);
  watcher.onDidDelete(scheduleRefresh);
  context.subscriptions.push(watcher);
}

function deactivate() {}

function getPreferredAgent(context) {
  const stored = context.workspaceState.get(PREFERRED_AGENT_KEY);
  return AGENT_HANDOFFS[stored] ? stored : "codex";
}

function getAgentLabel(agentId) {
  return (AGENT_HANDOFFS[agentId] ?? AGENT_HANDOFFS.codex).label;
}

async function choosePreferredAgent(context) {
  const current = getPreferredAgent(context);
  const selected = await vscode.window.showQuickPick(
    Object.entries(AGENT_HANDOFFS).map(([id, agent]) => ({
      description: id === current ? "current" : "",
      id,
      label: agent.label
    })),
    {
      ignoreFocusOut: true,
      placeHolder: "Choose the agent Context Delta should prepare for"
    }
  );

  if (!selected) return;
  await context.workspaceState.update(PREFERRED_AGENT_KEY, selected.id);
  refreshDashboard();
  vscode.window.showInformationMessage(`Context Delta will prepare current changes for ${selected.label}.`);
}

async function createPacket(context) {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  const preset = await vscode.window.showQuickPick(PACKET_PRESETS, {
    ignoreFocusOut: true,
    placeHolder: "What kind of packet are you preparing?"
  });
  if (!preset) return;

  if (preset.controls) {
    await replaceConfigControls(workspaceRoot, preset.controls);
    vscode.window.showInformationMessage(`Context Delta applied the ${preset.label} preset.`);
  }

  const task = preset.task || (await vscode.window.showInputBox({
    ignoreFocusOut: true,
    placeHolder: "Example: Add refresh token rotation for admin users",
    prompt: "What should the AI coding agent do?"
  }));

  if (!task) return;

  const mode =
    (await vscode.window.showQuickPick(
      [
        {
          label: "balanced",
          description: "Good default for everyday work"
        },
        {
          label: "conservative",
          description: "Include more context when missing context is risky"
        },
        {
          label: "strict",
          description: "Smaller packets with stronger policy pressure"
        }
      ],
      {
        ignoreFocusOut: true,
        placeHolder: `Choose packet mode, default ${preset.mode ?? "balanced"}`
      }
    ))?.label ?? preset.mode ?? "balanced";

  await vscode.window.withProgress(
    {
      cancellable: false,
      location: vscode.ProgressLocation.Notification,
      title: "Context Delta is building a context packet"
    },
    async () => {
      const packet = await buildPacket(workspaceRoot, task, mode, preset.limits);
      showPacketPanel(context, packet);
      refreshDashboard();
      vscode.window.showInformationMessage("Context Delta packet created.");
    }
  );
}

async function showLatestPacket(context) {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  try {
    const packet = await readLatestPacket(workspaceRoot);
    showPacketPanel(context, packet);
  } catch {
    vscode.window.showWarningMessage("No Context Delta packet found yet.");
  }
}

async function writeSnapshot() {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  await runCli(["snapshot", "--workspace", workspaceRoot]);
  refreshDashboard();
  vscode.window.showInformationMessage("Context Delta snapshot written.");
}

async function showMetrics(context) {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  openLivePanel(context, {
    viewType: "contextDeltaMetrics",
    title: "Context Delta Metrics",
    load: async () =>
      renderMetricsHtml(JSON.parse(await runCli(["metrics", "--workspace", workspaceRoot, "--json"])))
  });
}

async function writeConfig() {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  await runCli(["init", "--workspace", workspaceRoot]);
  await openConfig(workspaceRoot);
  refreshDashboard();
  vscode.window.showInformationMessage("Context Delta config opened.");
}

async function generateReport(context) {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  openLivePanel(context, {
    viewType: "contextDeltaReport",
    title: "Context Delta Report",
    load: async () => {
      const result = JSON.parse(await runCli(["report", "--workspace", workspaceRoot, "--json"]));
      return fs.readFile(result.report_path, "utf8");
    }
  });
  refreshDashboard();
}

async function showInsights(context) {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  openLivePanel(context, {
    viewType: "contextDeltaInsights",
    title: "Context Delta Insights",
    load: async () => renderInsightsHtml(await readLatestPacket(workspaceRoot))
  });
}

async function showPacketDiff(context) {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  openLivePanel(context, {
    viewType: "contextDeltaDiff",
    title: "Context Delta Diff",
    load: async () => renderTextHtml("Context Delta Diff", await runCli(["diff", "--workspace", workspaceRoot]))
  });
}

async function generateManagerSummary(context) {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  openLivePanel(context, {
    viewType: "contextDeltaManagerSummary",
    title: "Context Delta Summary",
    load: async () =>
      renderManagerSummaryHtml(JSON.parse(await runCli(["summary", "--workspace", workspaceRoot, "--json"])))
  });
  refreshDashboard();
}

async function showSetup(context) {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  openLivePanel(context, {
    viewType: "contextDeltaSetup",
    title: "Context Delta Setup",
    load: async () =>
      renderTextHtml("Context Delta Setup", await runCli(["setup", "--workspace", workspaceRoot, "--target", "vscode"]))
  });
}

async function fixSetup(context) {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  await vscode.window.withProgress(
    {
      cancellable: false,
      location: vscode.ProgressLocation.Notification,
      title: "Context Delta is installing the VS Code extension"
    },
    async () => {
      const markdown = await runCli(["setup", "--workspace", workspaceRoot, "--fix", "--target", "vscode"]);
      const panel = vscode.window.createWebviewPanel(
        "contextDeltaSetup",
        "Context Delta Setup",
        vscode.ViewColumn.Beside,
        { enableScripts: false }
      );
      panel.webview.html = renderTextHtml("Context Delta Setup", markdown);
      context.subscriptions.push(panel);
      refreshDashboard();
      vscode.window.showInformationMessage("Context Delta VS Code setup checked.");
    }
  );
}

async function showDrift(context) {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  openLivePanel(context, {
    viewType: "contextDeltaDrift",
    title: "Context Delta Drift",
    load: async () => renderTextHtml("Context Delta Drift", await runCli(["drift", "--workspace", workspaceRoot]))
  });
}

async function copyLatestPacket() {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  try {
    const packet = await fs.readFile(getLatestPacketPath(workspaceRoot), "utf8");
    await vscode.env.clipboard.writeText(packet);
    vscode.window.showInformationMessage("Context Delta packet JSON copied.");
  } catch {
    vscode.window.showWarningMessage("No Context Delta packet found yet.");
  }
}

async function copyCompactPacket() {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  try {
    const packet = await readLatestPacket(workspaceRoot);
    const compactView = packet.compact_view ?? {
      budget: packet.budget,
      id: packet.id,
      included: uniqueItems([
        ...packet.changed_artifacts,
        ...packet.supporting_evidence,
        ...packet.governing_constraints,
        ...packet.impacted_neighbors
      ]).map((item) => ({
        heading: item.heading,
        path: item.path,
        reason: item.reason,
        type: item.type || item.kind || "context"
      })),
      insights: packet.insights,
      intent: packet.intent,
      metrics: packet.metrics,
      summary: packet.summary,
      warnings: packet.warnings
    };
    await vscode.env.clipboard.writeText(JSON.stringify(compactView, null, 2));
    vscode.window.showInformationMessage("Context Delta compact packet copied.");
  } catch {
    vscode.window.showWarningMessage("No Context Delta packet found yet.");
  }
}

async function copyAgentHandoff() {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  const selected = await vscode.window.showQuickPick(
    [
      { label: "copilot", description: "Prompt-ready handoff for GitHub Copilot Chat" },
      { label: "spec-kit", description: "Spec-first handoff for Spec Kit workflows" },
      { label: "markdown", description: "General prompt-ready Markdown handoff" },
      { label: "compact", description: "Metadata-only JSON preview" },
      { label: "json", description: "Full packet JSON" },
      { label: "replay", description: "Review prompt for checking an agent result against the packet" }
    ],
    {
      ignoreFocusOut: true,
      placeHolder: "Choose handoff format"
    }
  );

  if (!selected) return;
  const handoff = await runCli(["handoff", "--workspace", workspaceRoot, "--format", selected.label]);
  await vscode.env.clipboard.writeText(handoff);
  vscode.window.showInformationMessage(`Context Delta ${selected.label} handoff copied.`);
}

async function prepareAndCopyForAgent(context, agentId, options = {}) {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  const agent = AGENT_HANDOFFS[agentId] ?? AGENT_HANDOFFS.codex;
  if (AGENT_HANDOFFS[agentId]) {
    await context.workspaceState.update(PREFERRED_AGENT_KEY, agentId);
  }
  const latestTask = options.inferTask ? "" : await getLatestTask(workspaceRoot);
  const task = latestTask || "";

  const inferred = inferTaskPreset(task);
  if (inferred?.controls) {
    await replaceConfigControls(workspaceRoot, inferred.controls);
  }

  await vscode.window.withProgress(
    {
      cancellable: false,
      location: vscode.ProgressLocation.Notification,
      title: `Context Delta is preparing context for ${agent.label}`
    },
    async () => {
      const args = ["prepare"];
      if (task) args.push(task);
      args.push("--workspace", workspaceRoot, "--format", agent.format);
      if (inferred?.mode) args.push("--mode", inferred.mode);
      appendLimitArgs(args, inferred?.limits);
      const handoff = await runCli(args);
      await vscode.env.clipboard.writeText(handoff);
      const packet = await readLatestPacket(workspaceRoot);
      showPacketPanel(context, packet);
      refreshDashboard();
      const presetNote = inferred ? ` with ${inferred.label}` : "";
      const taskNote = task ? "" : " from current changes";
      vscode.window.showInformationMessage(`Context Delta copied a ${agent.label} handoff${taskNote}${presetNote}.`);
    }
  );
}

async function copyReplayPrompt() {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  try {
    const replay = await runCli(["replay", "--workspace", workspaceRoot]);
    await vscode.env.clipboard.writeText(replay);
    vscode.window.showInformationMessage("Context Delta replay prompt copied.");
  } catch {
    vscode.window.showWarningMessage("No Context Delta packet found yet.");
  }
}

async function approveLatestPacket() {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  const selected = await vscode.window.showQuickPick(
    [
      { label: "approved", description: "Packet is ready to hand to the agent" },
      { label: "needs-expansion", description: "Packet is useful but missing context" },
      { label: "failed", description: "Packet is not acceptable for this task" }
    ],
    {
      ignoreFocusOut: true,
      placeHolder: "Record packet review decision"
    }
  );
  if (!selected) return;

  await runCli(["approve", "--workspace", workspaceRoot, "--decision", selected.label]);
  refreshDashboard();
  vscode.window.showInformationMessage(`Context Delta packet marked ${selected.label}.`);
}

async function tuneControls() {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  const selected = await vscode.window.showQuickPick(
    [
      { label: "Add pinned path", description: "Always include a file or folder path" },
      { label: "Add excluded path", description: "Omit a file or folder path" },
      { label: "Use automatic ranking", description: "Clear manual controls and let Context Delta choose" },
      { label: "Clear controls", description: "Remove all pin and exclude controls" },
      { label: "Open config", description: "Edit contextdelta.config.json directly" }
    ],
    {
      ignoreFocusOut: true,
      placeHolder: "Tune Context Delta controls"
    }
  );

  if (!selected) return;

  if (selected.label === "Add pinned path") {
    await promptForControlPath(workspaceRoot, "pin");
  } else if (selected.label === "Add excluded path") {
    await promptForControlPath(workspaceRoot, "exclude");
  } else if (selected.label === "Use automatic ranking") {
    await clearControls(workspaceRoot);
    vscode.window.showInformationMessage("Context Delta will use automatic ranking.");
  } else if (selected.label === "Clear controls") {
    await clearControls(workspaceRoot);
    vscode.window.showInformationMessage("Context Delta controls cleared.");
  } else if (selected.label === "Open config") {
    await openConfig(workspaceRoot);
  }

  await rebuildLatestPacketFromControls(workspaceRoot);
  refreshDashboard();
}

async function cleanupControlsCommand() {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  const result = await cleanupStaleControls(workspaceRoot);
  const rebuilt = result.removed_count > 0 ? await rebuildLatestPacketFromControls(workspaceRoot) : false;
  refreshDashboard();
  vscode.window.showInformationMessage(
    result.removed_count > 0
      ? `Context Delta removed ${result.removed_count} stale control${result.removed_count === 1 ? "" : "s"}${rebuilt ? " and rebuilt the packet" : ""}.`
      : "Context Delta controls are already clean."
  );
}

async function clearControlsCommand() {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  await clearControls(workspaceRoot);
  await rebuildLatestPacketFromControls(workspaceRoot);
  refreshDashboard();
  vscode.window.showInformationMessage("Context Delta controls cleared.");
}

async function addControlPathCommand(control) {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  const value = await promptForControlPath(workspaceRoot, control);
  if (!value) return;
  await rebuildLatestPacketFromControls(workspaceRoot);
  refreshDashboard();
}

function showPacketPanel(context, packet) {
  const panel = vscode.window.createWebviewPanel(
    "contextDeltaPacket",
    "Context Delta Packet",
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  const state = { packet };
  panel.webview.html = renderPacketHtml(state.packet);
  panel.webview.onDidReceiveMessage(
    (message) => handlePacketMessage(context, message, state, panel),
    null,
    context.subscriptions
  );
  context.subscriptions.push(panel);
}

// Opens a webview panel whose content can be refreshed in place. A Refresh
// button re-runs `load` and re-renders, so users see new numbers without
// closing and reopening the panel.
function openLivePanel(context, { viewType, title, column = vscode.ViewColumn.Beside, load }) {
  const panel = vscode.window.createWebviewPanel(viewType, title, column, { enableScripts: true });
  context.subscriptions.push(panel);
  let busy = false;
  const update = async () => {
    if (busy) return;
    busy = true;
    try {
      panel.webview.html = injectRefreshChrome(await load());
    } catch (error) {
      panel.webview.html = injectRefreshChrome(
        renderTextHtml(title, `Could not load yet: ${error?.message ?? error}\n\nClick Refresh once the data is available.`)
      );
    } finally {
      busy = false;
    }
  };
  panel.webview.onDidReceiveMessage(
    (message) => {
      if (message?.command === "refresh") update();
    },
    null,
    context.subscriptions
  );
  update();
  return panel;
}

// Injects a sticky Refresh button (and the messaging bridge) into a rendered
// HTML document so the panel can reload its data in place.
function injectRefreshChrome(html) {
  const bar =
    '<div style="position:sticky;top:0;z-index:20;display:flex;justify-content:flex-end;padding:8px 12px;' +
    "background:var(--vscode-editor-background);border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.25));\">" +
    '<button onclick="cdRefresh()" title="Reload with the latest data" style="cursor:pointer;font:inherit;' +
    "padding:4px 14px;border-radius:6px;border:1px solid var(--vscode-button-border,transparent);" +
    "background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);\">&#x21bb; Refresh</button></div>";
  const script =
    "<script>const cdApi=acquireVsCodeApi();function cdRefresh(){cdApi.postMessage({command:'refresh'});}</script>";
  if (html.includes("<body>")) {
    return html.replace("<body>", `<body>${bar}`).replace("</body>", `${script}</body>`);
  }
  return `${bar}${html}${script}`;
}

function renderPacketHtml(packet) {
  const included = getPacketItems(packet);
  const insights = packet.insights ?? {};

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: var(--vscode-font-family); padding: 24px; color: var(--vscode-foreground); line-height: 1.45; }
    h1 { margin: 0 0 4px; }
    h2 { margin-top: 28px; }
    .subtle { color: var(--vscode-descriptionForeground); }
    .handoff { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin: 18px 0; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 18px; }
    .metric { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 12px; background: var(--vscode-editor-background); }
    .metric strong { display: block; font-size: 1.4rem; }
    .item { border: 1px solid var(--vscode-panel-border); border-radius: 8px; margin: 8px 0; padding: 12px; background: var(--vscode-editor-background); }
    .bucket { color: var(--vscode-descriptionForeground); font-size: 0.82rem; text-transform: uppercase; }
    .reason { margin-top: 4px; color: var(--vscode-descriptionForeground); }
    .warning { border-color: var(--vscode-editorWarning-foreground); }
    .pill { border: 1px solid var(--vscode-panel-border); border-radius: 999px; display: inline-block; margin: 4px 6px 4px 0; padding: 3px 8px; }
    .insights { display: grid; grid-template-columns: 1.3fr 0.7fr; gap: 12px; margin-top: 16px; }
    .signal { border-top: 1px solid var(--vscode-panel-border); padding: 8px 0; }
    .signal:first-child { border-top: 0; }
    .item-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    details { border: 1px solid var(--vscode-panel-border); border-radius: 8px; margin: 18px 0; padding: 12px; background: var(--vscode-editor-background); }
    details summary { cursor: pointer; font-weight: 700; }
    button { background: var(--vscode-button-secondaryBackground); border: 0; border-radius: 6px; color: var(--vscode-button-secondaryForeground); cursor: pointer; min-height: 26px; padding: 4px 8px; }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    ul { margin-top: 8px; padding-left: 18px; }
    code { color: var(--vscode-textLink-foreground); }
    pre { white-space: pre-wrap; background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 6px; }
    @media (max-width: 760px) { .insights { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>Context Packet Ready</h1>
  <div class="subtle">${escapeHtml(packet.intent.task)}</div>
  <div>
    <span class="pill">Mode: ${escapeHtml(packet.controls?.mode ?? "balanced")}</span>
    <span class="pill">Budget: ${escapeHtml(packet.budget?.pressure ?? "unknown")}</span>
    <span class="pill">Redactions: ${escapeHtml(packet.security?.redactions_applied ?? 0)}</span>
  </div>
  <section class="item">
    <div class="bucket">Agent Handoff</div>
    <strong>Use this when the packet looks good enough.</strong>
    <div class="reason">Context Delta prepared the working context. Copy it to your agent and keep moving.</div>
    <div class="handoff">
      <button class="primary" data-command="copyCodex">Copy for Codex</button>
      <button class="primary" data-command="copyClaude">Copy for Claude</button>
      <button class="primary" data-command="copyCopilot">Copy for Copilot</button>
    </div>
  </section>
  <section class="insights">
    <div class="item">
      <div class="bucket">Insight</div>
      <strong>${escapeHtml(insights.headline ?? "No insight available")}</strong>
      <div class="reason">Risk: ${escapeHtml(insights.risk_level ?? "unknown")}</div>
      ${(insights.cards ?? []).map(renderInsightCard).join("")}
    </div>
    <div class="item">
      <div class="bucket">Next Steps</div>
      <ul>${(insights.recommendations ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  </section>
  <section class="summary">
    ${metric("Changed", packet.summary.changed_files_count)}
    ${metric("Included", packet.summary.included_files_count)}
    ${metric("Tests", packet.summary.included_tests_count)}
    ${metric("Specs", packet.summary.included_spec_units_count)}
    ${metric("Excluded", packet.summary.excluded_files_count)}
    ${metric("Reduction", `${packet.metrics.context_reduction_percent}%`)}
    ${metric("Useful Density", `${packet.metrics.heuristic_useful_context_density_percent ?? 0}%`)}
    ${metric("Saved", `${packet.metrics.tokens_saved_estimate} tokens`)}
    ${metric("Token count", formatTokenMethod(packet.metrics))}
  </section>
  ${renderBaselines(packet.metrics)}
  <h2>Warnings</h2>
  ${packet.warnings.length ? packet.warnings.map(renderWarning).join("") : '<p class="subtle">No warnings.</p>'}
  <details>
    <summary>Advanced context controls</summary>
    <p class="subtle">Use this when you want to choose exact files, folders, or packet tuning rules.</p>
    <div class="handoff">
      <button data-command="includePath">Include Path</button>
      <button data-command="excludePath">Exclude Path</button>
      <button data-command="tuneControls">Tune Presets</button>
      <button data-command="rebuild">Rebuild Packet</button>
      <button data-command="clearControls">Clear Controls</button>
    </div>
    <div class="item">
      <div><strong>Pinned</strong></div>
      <div class="reason">${escapeHtml((packet.controls?.pinned ?? []).join(", ") || "None")}</div>
    </div>
    <div class="item">
      <div><strong>Excluded</strong></div>
      <div class="reason">${escapeHtml((packet.controls?.excluded ?? []).join(", ") || "None")}</div>
    </div>
  </details>
  <details>
    <summary>Included context (${included.length})</summary>
    ${included.map((item, index) => renderItem(item, index)).join("")}
  </details>
  <details>
    <summary>Excluded context (${packet.excluded.length})</summary>
    ${packet.excluded.map((item, index) => renderItem(item, included.length + index)).join("")}
  </details>
  <details>
    <summary>Raw packet JSON</summary>
    <pre>${escapeHtml(JSON.stringify(packet, null, 2))}</pre>
  </details>
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll("button[data-command]").forEach((button) => {
      button.addEventListener("click", () => {
        vscode.postMessage({
          command: button.dataset.command,
          index: Number(button.dataset.index)
        });
      });
    });
  </script>
</body>
</html>`;
}

function renderInsightsHtml(packet) {
  const insights = packet.insights ?? {};
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: var(--vscode-font-family); padding: 24px; color: var(--vscode-foreground); line-height: 1.45; }
    h1 { margin: 0 0 6px; }
    .subtle { color: var(--vscode-descriptionForeground); }
    .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top: 18px; }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 14px; background: var(--vscode-editor-background); }
    .card strong { display: block; margin-bottom: 6px; }
    ul { padding-left: 18px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(insights.headline ?? "Context Delta Insights")}</h1>
  <div class="subtle">${escapeHtml(packet.intent.task)}</div>
  <p>Risk: ${escapeHtml(insights.risk_level ?? "unknown")}</p>
  <section class="grid">
    ${(insights.cards ?? []).map((card) => `<div class="card"><strong>${escapeHtml(card.title)}</strong><div class="subtle">${escapeHtml(card.body)}</div></div>`).join("")}
  </section>
  <h2>Recommendations</h2>
  <ul>${(insights.recommendations ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  <h2>Top Paths</h2>
  <section class="grid">
    ${(insights.top_paths ?? []).map((item) => `<div class="card"><code>${escapeHtml(item.path ?? "unknown")}${item.heading ? `#${escapeHtml(item.heading)}` : ""}</code><div class="subtle">${escapeHtml(item.reason ?? "")}</div></div>`).join("")}
  </section>
</body>
</html>`;
}

function renderMetricsHtml(metrics) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: var(--vscode-font-family); padding: 24px; color: var(--vscode-foreground); }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .metric { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 12px; }
    .metric strong { display: block; font-size: 1.4rem; }
  </style>
</head>
<body>
  <h1>Context Delta Metrics</h1>
  <section class="summary">
    ${metric("Sessions", metrics.sessions)}
    ${metric("Tokens Saved", metrics.tokens_saved_estimate)}
    ${metric("Avg Reduction", `${metrics.average_context_reduction_percent}%`)}
    ${metric("Useful Density", `${metrics.average_useful_context_density_percent ?? 0}%`)}
    ${metric("Avg Packet", `${metrics.average_packet_tokens_estimate} tokens`)}
    ${metric("Overrides", metrics.manual_overrides ?? 0)}
    ${metric("Stale Specs", metrics.stale_spec_warnings)}
    ${metric("Redactions", metrics.redactions_applied)}
    ${metric("Risk Mix", formatCounts(metrics.risk_counts))}
    ${metric("Budget Mix", formatCounts(metrics.budget_pressure_counts))}
  </section>
</body>
</html>`;
}

function renderTextHtml(title, text) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: var(--vscode-font-family); padding: 24px; color: var(--vscode-foreground); line-height: 1.45; }
    pre { white-space: pre-wrap; background: var(--vscode-textCodeBlock-background); border-radius: 8px; padding: 16px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <pre>${escapeHtml(text)}</pre>
</body>
</html>`;
}

function renderManagerSummaryHtml(summary) {
  const data = summary.summary ?? {};
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: var(--vscode-font-family); padding: 24px; color: var(--vscode-foreground); line-height: 1.45; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .metric { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 12px; background: var(--vscode-editor-background); }
    .metric strong { display: block; font-size: 1.4rem; }
    li { margin: 6px 0; }
  </style>
</head>
<body>
  <h1>Context Delta Summary</h1>
  <section class="summary">
    ${metric("Sessions", data.sessions ?? 0)}
    ${metric("Tokens Saved", data.tokens_saved_estimate ?? 0)}
    ${metric("Avg Reduction", `${data.average_context_reduction_percent ?? 0}%`)}
    ${metric("Useful Density", `${data.average_useful_context_density_percent ?? 0}%`)}
    ${metric("Low Risk", `${data.low_risk_percent ?? 0}%`)}
    ${metric("Over Budget", `${data.over_budget_percent ?? 0}%`)}
    ${metric("Redactions", data.redactions_applied ?? 0)}
  </section>
  <h2>Recommendations</h2>
  <ul>${(summary.recommendations ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  <h2>Raw Summary</h2>
  <pre>${escapeHtml(JSON.stringify(summary, null, 2))}</pre>
</body>
</html>`;
}

function renderItem(item, index) {
  return `<div class="item">
    <div class="bucket">${escapeHtml(item.type || item.kind || "context")}</div>
    <div><code>${escapeHtml(item.path || "unknown")}${item.heading ? `#${escapeHtml(item.heading)}` : ""}</code></div>
    <div class="reason">${escapeHtml(item.reason || "")}</div>
    <div class="item-actions">
      <button class="primary" data-command="open" data-index="${index}">Open</button>
      <button data-command="copyPath" data-index="${index}">Copy Path</button>
      <button data-command="copySnippet" data-index="${index}">Copy Snippet</button>
      <button data-command="pin" data-index="${index}">Pin</button>
      <button data-command="exclude" data-index="${index}">Exclude</button>
    </div>
  </div>`;
}

function renderWarning(warning) {
  return `<div class="item warning">
    <div class="bucket">${escapeHtml(warning.type)}</div>
    <div>${escapeHtml(warning.message)}</div>
    ${renderWarningFix(warning)}
  </div>`;
}

function renderWarningFix(warning) {
  if (warning.type === "budget-over-target") {
    return '<div class="item-actions"><button data-command="tuneControls">Compact or tune</button><button data-command="rebuild">Rebuild</button></div>';
  }
  if (warning.type === "stale-spec") {
    return '<div class="item-actions"><button data-command="includePath">Choose spec or docs</button></div>';
  }
  if (warning.type === "instruction-precedence") {
    return '<div class="item-actions"><button data-command="includePath">Include governing file</button></div>';
  }
  return "";
}

function renderInsightCard(card) {
  return `<div class="signal">
    <strong>${escapeHtml(card.title)}</strong>
    <div class="reason">${escapeHtml(card.body)}</div>
  </div>`;
}

function metric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

// Renders the transparent baseline spectrum (open-files floor / naive-agent /
// whole-repo ceiling) so the savings number is shown as a range, not a single
// cherry-picked figure. Each baseline's assumption is available on hover.
function renderBaselines(metrics) {
  const baselines = metrics?.baselines;
  if (!baselines) return "";
  const order = [
    ["open_files_only", "Open files only"],
    ["naive_agent", "Naive agent"],
    ["whole_repo", "Whole repo"]
  ];
  const rows = order
    .filter(([key]) => baselines[key])
    .map(([key, label]) => {
      const baseline = baselines[key];
      return `<div class="metric" title="${escapeHtml(baseline.note ?? "")}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(baseline.reduction_percent))}% · ${escapeHtml(String(baseline.tokens_estimate))} tok</strong></div>`;
    })
    .join("");
  if (!rows) return "";
  return `<h2>Reduction vs baselines</h2>
  <p class="subtle">How much smaller the delivered context is than what each baseline would pull. Hover for the assumption.</p>
  <section class="summary">${rows}</section>`;
}

// Describes how the packet measured tokens: exact (real tokenizer, with the
// resolved model/encoding) or an estimated heuristic fallback.
function formatTokenMethod(metrics) {
  if (!metrics) return "unknown";
  if (metrics.token_count_method === "exact_tokenizer") {
    const target =
      metrics.target_model && metrics.target_model !== "default"
        ? metrics.target_model
        : metrics.tokenizer_encoding ?? "o200k_base";
    return `exact · ${target}`;
  }
  return "estimated";
}

class ContextDeltaDashboardProvider {
  constructor(context) {
    this.context = context;
    this.view = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this.context.subscriptions);
    this.refresh();
  }

  async refresh() {
    if (!this.view) return;
    const workspaceRoot = getWorkspaceRoot({ quiet: true });
    let packet = null;
    let metrics = null;

    if (workspaceRoot) {
      try {
        packet = await readLatestPacket(workspaceRoot);
      } catch {
        packet = null;
      }

      try {
        metrics = JSON.parse(await runCli(["metrics", "--workspace", workspaceRoot, "--json"]));
      } catch {
        metrics = null;
      }
    }

    this.view.webview.html = renderDashboardHtml({
      metrics,
      packet,
      preferredAgent: getPreferredAgent(this.context),
      workspaceRoot
    });
    updateStatusBar(packet, workspaceRoot, getPreferredAgent(this.context));
  }

  async handleMessage(message) {
    const command = message?.command;
    if (!command) return;

    if (command === "create") await vscode.commands.executeCommand("contextDelta.createPacket");
    if (command === "show") await vscode.commands.executeCommand("contextDelta.showLatestPacket");
    if (command === "insights") await vscode.commands.executeCommand("contextDelta.showInsights");
    if (command === "report") await vscode.commands.executeCommand("contextDelta.generateReport");
    if (command === "diff") await vscode.commands.executeCommand("contextDelta.showPacketDiff");
    if (command === "summary") await vscode.commands.executeCommand("contextDelta.generateManagerSummary");
    if (command === "metrics") await vscode.commands.executeCommand("contextDelta.showMetrics");
    if (command === "snapshot") await vscode.commands.executeCommand("contextDelta.writeSnapshot");
    if (command === "config") await vscode.commands.executeCommand("contextDelta.writeConfig");
    if (command === "copy") await vscode.commands.executeCommand("contextDelta.copyLatestPacket");
    if (command === "copyCodex") await vscode.commands.executeCommand("contextDelta.copyForCodex");
    if (command === "copyClaude") await vscode.commands.executeCommand("contextDelta.copyForClaude");
    if (command === "copyCopilot") await vscode.commands.executeCommand("contextDelta.copyForCopilot");
    if (command === "compact") await vscode.commands.executeCommand("contextDelta.copyCompactPacket");
    if (command === "handoff") await vscode.commands.executeCommand("contextDelta.copyAgentHandoff");
    if (command === "replay") await vscode.commands.executeCommand("contextDelta.copyReplayPrompt");
    if (command === "approve") await vscode.commands.executeCommand("contextDelta.approveLatestPacket");
    if (command === "includePath") await vscode.commands.executeCommand("contextDelta.includePath");
    if (command === "excludePath") await vscode.commands.executeCommand("contextDelta.excludePath");
    if (command === "tuneControls") await vscode.commands.executeCommand("contextDelta.tuneControls");
    if (command === "cleanupControls") await vscode.commands.executeCommand("contextDelta.cleanupControls");
    if (command === "clearControls") await vscode.commands.executeCommand("contextDelta.clearControls");
    if (command === "setup") await vscode.commands.executeCommand("contextDelta.showSetup");
    if (command === "fixSetup") await vscode.commands.executeCommand("contextDelta.fixSetup");
    if (command === "drift") await vscode.commands.executeCommand("contextDelta.showDrift");
    if (command === "chooseAgent") await vscode.commands.executeCommand("contextDelta.chooseAgent");
    if (command === "prepareCurrent") await vscode.commands.executeCommand("contextDelta.prepareCurrentChanges");
    if (command === "refresh") await this.refresh();
  }
}

function renderDashboardHtml({ metrics, packet, preferredAgent, workspaceRoot }) {
  const insights = packet?.insights ?? null;
  const preferredAgentLabel = getAgentLabel(preferredAgent);
  const cards = [
    ["Risk", insights?.risk_level ?? "unknown"],
    ["Saved", packet ? `${packet.metrics.tokens_saved_estimate} tokens` : metrics?.tokens_saved_estimate ?? "0"],
    ["Density", packet ? `${packet.metrics.heuristic_useful_context_density_percent ?? 0}%` : `${metrics?.average_useful_context_density_percent ?? 0}%`],
    ["Budget", packet?.budget?.pressure ?? "unknown"]
  ];

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); line-height: 1.4; padding: 12px; }
    h2 { font-size: 1.05rem; margin: 0 0 4px; }
    h3 { font-size: 0.82rem; letter-spacing: 0; margin: 18px 0 8px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
    .subtle { color: var(--vscode-descriptionForeground); }
    .grid { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 12px 0; }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 10px; background: var(--vscode-editor-background); min-height: 48px; }
    .card span { color: var(--vscode-descriptionForeground); display: block; font-size: 0.78rem; }
    .card strong { display: block; margin-top: 3px; overflow-wrap: anywhere; }
    .actions { display: grid; gap: 8px; }
    .agent-actions { display: grid; gap: 8px; margin: 14px 0; }
    details { border: 1px solid var(--vscode-panel-border); border-radius: 8px; margin-top: 16px; padding: 10px; background: var(--vscode-editor-background); }
    summary { cursor: pointer; font-weight: 700; }
    button { align-items: center; background: var(--vscode-button-background); border: 0; border-radius: 6px; color: var(--vscode-button-foreground); cursor: pointer; display: flex; justify-content: center; min-height: 30px; padding: 6px 10px; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .item { border-top: 1px solid var(--vscode-panel-border); padding: 8px 0; }
    code { color: var(--vscode-textLink-foreground); overflow-wrap: anywhere; }
    ul { margin: 8px 0 0; padding-left: 18px; }
  </style>
</head>
<body>
  <h2>Context Delta</h2>
  <div class="subtle">${workspaceRoot ? escapeHtml(path.basename(workspaceRoot)) : "Open a workspace to start"}</div>
  <div class="grid">
    ${cards.map(([label, value]) => `<div class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
  </div>
  <h3>Agent Flow</h3>
  <div class="subtle">Default agent: ${escapeHtml(preferredAgentLabel)}. Prepare once, paste the handoff, then use drift only when edits need review.</div>
  <div class="agent-actions">
    <button data-command="prepareCurrent">Prepare Current Changes for ${escapeHtml(preferredAgentLabel)}</button>
    <button class="secondary" data-command="chooseAgent">Change Default Agent</button>
    <button class="secondary" data-command="drift">Review Drift After Agent Edits</button>
  </div>

  <h3>Latest Insight</h3>
  ${packet ? `<div class="item"><strong>${escapeHtml(insights?.headline ?? "No insight available")}</strong><ul>${(insights?.recommendations ?? []).slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : '<div class="subtle">No packet yet.</div>'}

  <h3>Top Context</h3>
  ${packet ? (insights?.top_paths ?? []).slice(0, 5).map((item) => `<div class="item"><code>${escapeHtml(item.path ?? "unknown")}${item.heading ? `#${escapeHtml(item.heading)}` : ""}</code><div class="subtle">${escapeHtml(item.reason ?? "")}</div></div>`).join("") : '<div class="subtle">Create a packet to see selected files.</div>'}

  <details>
    <summary>Advanced controls</summary>
    <p class="subtle">Choose exact files or folders only when the automatic packet needs help.</p>
    <div class="actions">
      <button class="secondary" data-command="includePath">Include Path</button>
      <button class="secondary" data-command="excludePath">Exclude Path</button>
      <button class="secondary" data-command="tuneControls">Tune Presets</button>
      <button class="secondary" data-command="cleanupControls">Remove Stale Controls</button>
      <button class="secondary" data-command="clearControls">Clear Controls</button>
      <button class="secondary" data-command="copyCodex">Prepare & Copy for Codex</button>
      <button class="secondary" data-command="copyClaude">Prepare & Copy for Claude</button>
      <button class="secondary" data-command="copyCopilot">Prepare & Copy for Copilot</button>
      <button class="secondary" data-command="setup">Check VS Code Setup</button>
      <button class="secondary" data-command="fixSetup">Install VS Code Extension</button>
      <button class="secondary" data-command="create">Prepare Packet Only</button>
      <button class="secondary" data-command="show">Open Latest Packet</button>
      <button class="secondary" data-command="insights">Open Insights</button>
      <button class="secondary" data-command="diff">Open Packet Diff</button>
      <button class="secondary" data-command="handoff">Choose Handoff Format</button>
      <button class="secondary" data-command="replay">Copy Replay Prompt</button>
      <button class="secondary" data-command="approve">Approve / Review Packet</button>
      <button class="secondary" data-command="compact">Copy Compact Packet</button>
      <button class="secondary" data-command="report">Generate Report</button>
      <button class="secondary" data-command="summary">Manager Summary</button>
      <button class="secondary" data-command="metrics">Metrics</button>
      <button class="secondary" data-command="snapshot">Snapshot</button>
      <button class="secondary" data-command="config">Open Config</button>
      <button class="secondary" data-command="refresh">Refresh</button>
    </div>
  </details>

  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll("button[data-command]").forEach((button) => {
      button.addEventListener("click", () => vscode.postMessage({ command: button.dataset.command }));
    });
  </script>
</body>
</html>`;
}

function refreshDashboard() {
  dashboardProvider?.refresh();
}

function updateStatusBar(packet, workspaceRoot, preferredAgent = "codex") {
  if (!statusBarItem) return;
  const preferredAgentLabel = getAgentLabel(preferredAgent);
  if (!workspaceRoot) {
    statusBarItem.text = "$(circle-slash) Context Delta";
    statusBarItem.tooltip = "Open a workspace to use Context Delta";
    return;
  }

  if (!packet) {
    statusBarItem.text = "$(sync) Context Delta";
    statusBarItem.tooltip = `Prepare context for ${preferredAgentLabel}`;
    return;
  }

  const risk = packet.insights?.risk_level ?? "unknown";
  const budget = packet.budget?.pressure ?? "unknown";
  const warningCount = packet.warnings?.length ?? 0;
  const icon = risk === "high" ? "$(warning)" : "$(check)";
  const meter = formatWasteMeter(packet.metrics);
  statusBarItem.text = meter.text
    ? `${icon} Context ready · ${risk} · ${meter.text}`
    : `${icon} Context ready · ${risk}`;
  statusBarItem.tooltip = `Context Delta ready. Budget: ${budget}. Warnings: ${warningCount}.${meter.tooltip} Click to prepare and copy for ${preferredAgentLabel}.`;
}

// Builds the status-bar "waste meter": a compact reduction badge plus an honest,
// token-level breakdown in the tooltip. Returns empty strings when metrics are
// missing or the reduction is non-positive, so we never show a misleading badge.
function formatWasteMeter(metrics) {
  if (!metrics) return { text: "", tooltip: "" };
  const reduction = Number(metrics.context_reduction_percent);
  const saved = Number(metrics.tokens_saved_estimate ?? metrics.wasted_tokens_estimate);
  const baseline = Number(metrics.baseline_tokens_estimate);
  const delivered = Number(metrics.delivered_tokens_estimate);
  if (!Number.isFinite(reduction) || reduction <= 0 || !Number.isFinite(saved) || saved <= 0) {
    return { text: "", tooltip: "" };
  }
  const text = `$(flame) -${Math.round(reduction)}% context`;
  const tooltip =
    ` Waste meter: ~${formatTokenCount(saved)} fewer tokens than a naive pull` +
    (Number.isFinite(baseline) && Number.isFinite(delivered)
      ? ` (~${formatTokenCount(delivered)} delivered vs ~${formatTokenCount(baseline)} baseline, byte-based estimate).`
      : ` (byte-based estimate).`);
  return { text, tooltip };
}

// Compact human-readable token counts (e.g. 1234 -> "1.2k") for the status bar.
function formatTokenCount(value) {
  const n = Math.round(Number(value) || 0);
  if (n >= 1000) {
    const thousands = n / 1000;
    return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}k`;
  }
  return String(n);
}

async function handlePacketMessage(context, message, state, panel) {
  const packet = state.packet;
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;

  if (message.command === "copyCodex") {
    await copyLatestForAgent("codex", workspaceRoot);
    return;
  }

  if (message.command === "copyClaude") {
    await copyLatestForAgent("claude", workspaceRoot);
    return;
  }

  if (message.command === "copyCopilot") {
    await copyLatestForAgent("copilot", workspaceRoot);
    return;
  }

  if (message.command === "rebuild") {
    await rebuildPacketInPanel(workspaceRoot, state, panel);
    return;
  }

  if (message.command === "tuneControls") {
    await tuneControls();
    await rebuildPacketInPanel(workspaceRoot, state, panel);
    return;
  }

  if (message.command === "includePath" || message.command === "excludePath") {
    const control = message.command === "includePath" ? "pin" : "exclude";
    const value = await promptForControlPath(workspaceRoot, control);
    if (value) {
      await rebuildPacketInPanel(workspaceRoot, state, panel);
    }
    return;
  }

  if (message.command === "clearControls") {
    await clearControls(workspaceRoot);
    await rebuildPacketInPanel(workspaceRoot, state, panel);
    vscode.window.showInformationMessage("Context Delta controls cleared and packet rebuilt.");
    return;
  }

  const item = getAllPacketItems(packet)[message?.index];
  if (!item?.path) return;

  if (message.command === "open") {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(workspaceRoot, item.path))
    );
    const line = Math.max(0, Number(item.line_start ?? 1) - 1);
    await vscode.window.showTextDocument(document, {
      preview: false,
      selection: new vscode.Range(line, 0, line, 0)
    });
    return;
  }

  if (message.command === "copyPath") {
    await vscode.env.clipboard.writeText(item.path);
    vscode.window.showInformationMessage("Context Delta path copied.");
    return;
  }

  if (message.command === "copySnippet") {
    await vscode.env.clipboard.writeText(item.content || `${item.path}\n${item.reason || ""}`);
    vscode.window.showInformationMessage("Context Delta snippet copied.");
    return;
  }

  if (message.command === "pin" || message.command === "exclude") {
    await updateConfigControl(workspaceRoot, message.command === "pin" ? "pin" : "exclude", item.path);
    await rebuildPacketInPanel(workspaceRoot, state, panel);
    vscode.window.showInformationMessage(`Context Delta ${message.command} control saved for ${item.path} and packet rebuilt.`);
  }
}

async function updateConfigControl(workspaceRoot, control, value) {
  const config = await readConfig(workspaceRoot);
  config.controls = config.controls || {};
  config.controls[control] = [...new Set([...(config.controls[control] || []), value])];
  await writeConfigObject(workspaceRoot, config);
}

async function replaceConfigControls(workspaceRoot, controls) {
  const config = await readConfig(workspaceRoot);
  config.controls = {
    exclude: controls.exclude ?? [],
    pin: controls.pin ?? []
  };
  await writeConfigObject(workspaceRoot, config);
}

async function clearControls(workspaceRoot) {
  await replaceConfigControls(workspaceRoot, { exclude: [], pin: [] });
}

async function cleanupStaleControls(workspaceRoot) {
  const config = await readConfig(workspaceRoot);
  const controls = config.controls ?? {};
  const original = {
    exclude: controls.exclude ?? [],
    pin: controls.pin ?? []
  };
  const cleaned = {
    exclude: [],
    pin: []
  };

  for (const control of ["exclude", "pin"]) {
    for (const value of original[control]) {
      if (await controlPathExists(workspaceRoot, value)) {
        cleaned[control].push(value);
      }
    }
  }

  const removed = [
    ...original.exclude.filter((item) => !cleaned.exclude.includes(item)),
    ...original.pin.filter((item) => !cleaned.pin.includes(item))
  ];
  config.controls = cleaned;
  if (removed.length > 0) {
    await writeConfigObject(workspaceRoot, config);
  }

  return {
    removed,
    removed_count: removed.length
  };
}

async function controlPathExists(workspaceRoot, value) {
  if (!value || /[*?[\]{}]/.test(value)) return true;
  const normalized = value.replace(/\/+$/, "");
  if (!normalized) return true;
  try {
    await fs.access(path.join(workspaceRoot, normalized));
    return true;
  } catch {
    return false;
  }
}

async function promptForControlPath(workspaceRoot, control) {
  const candidates = await getControlPathCandidates(workspaceRoot, control);
  const selected = await vscode.window.showQuickPick(
    [
      ...candidates,
      {
        label: "$(edit) Type a path manually",
        description: control === "pin" ? "Include any file or folder path" : "Exclude any file or folder path",
        value: "__manual__"
      }
    ],
    {
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: control === "pin" ? "Choose a file or folder to include" : "Choose a file or folder to exclude"
    }
  );
  if (!selected) return null;

  let value = selected.value;
  if (value === "__manual__") {
    value = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      placeHolder: control === "pin" ? "docs/index.html or docs/site/" : "examples/ or tests/engine.test.js",
      prompt: control === "pin" ? "Path or folder to include" : "Path or folder to exclude"
    });
  }
  if (!value) return;
  await updateConfigControl(workspaceRoot, control, value);
  vscode.window.showInformationMessage(`Context Delta ${control} control saved for ${value}.`);
  return value;
}

async function getControlPathCandidates(workspaceRoot, control) {
  const seen = new Set();
  const choices = [];
  const addChoice = (value, description, detail) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    choices.push({
      label: value,
      description,
      detail,
      value
    });
  };

  try {
    const packet = await readLatestPacket(workspaceRoot);
    const items =
      control === "pin"
        ? packet.excluded ?? []
        : getPacketItems(packet);
    for (const item of items) {
      addChoice(item.path, item.reason ?? "", item.heading ? `Section: ${item.heading}` : "");
    }
  } catch {
    // Fall back to common repo-level controls below.
  }

  addChoice("src/", "Source files", "Folder control");
  addChoice("tests/", "Tests folder", "Folder control");
  addChoice("docs/", "Documentation folder", "Folder control");
  addChoice("public/", "Public/static assets", "Folder control");
  addChoice("site/", "Website or static site assets", "Folder control");
  addChoice(".github/", "GitHub workflow and template files", "Folder control");
  addChoice("examples/", "Examples or demo workspace", "Folder control");

  return choices;
}

async function openConfig(workspaceRoot) {
  const config = await readConfig(workspaceRoot);
  await writeConfigObject(workspaceRoot, config);
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(path.join(workspaceRoot, "contextdelta.config.json"))
  );
  await vscode.window.showTextDocument(document, { preview: false });
}

async function readConfig(workspaceRoot) {
  const configPath = path.join(workspaceRoot, "contextdelta.config.json");
  try {
    return JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch {
    await runCli(["init", "--workspace", workspaceRoot]);
    return JSON.parse(await fs.readFile(configPath, "utf8"));
  }
}

async function writeConfigObject(workspaceRoot, config) {
  const configPath = path.join(workspaceRoot, "contextdelta.config.json");
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function buildPacket(workspaceRoot, task, mode = "balanced", limits = {}) {
  const args = [
    "packet",
    task,
    "--workspace",
    workspaceRoot,
    "--mode",
    mode,
    "--json"
  ];
  appendLimitArgs(args, limits);
  const output = await runCli(args);
  return JSON.parse(output).packet;
}

function appendLimitArgs(args, limits = {}) {
  if (limits.changed) args.push("--changed", String(limits.changed));
  if (limits.markdownSections) args.push("--markdown-sections", String(limits.markdownSections));
  if (limits.snippetChars) args.push("--snippet-chars", String(limits.snippetChars));
  if (limits.targetTokens) args.push("--target-tokens", String(limits.targetTokens));
  if (limits.tests) args.push("--tests", String(limits.tests));
  if (limits.instructions) args.push("--instructions", String(limits.instructions));
}

async function rebuildPacketInPanel(workspaceRoot, state, panel) {
  const task = state.packet.intent?.task;
  const mode = state.packet.controls?.mode ?? "balanced";
  if (!task) return;
  const inferred = inferTaskPreset(task);
  const packet = await buildPacket(workspaceRoot, task, mode, inferred?.limits);
  state.packet = packet;
  panel.webview.html = renderPacketHtml(packet);
  refreshDashboard();
}

async function rebuildLatestPacketFromControls(workspaceRoot) {
  try {
    const packet = await readLatestPacket(workspaceRoot);
    const task = packet.intent?.task;
    if (!task) return false;
    const mode = packet.controls?.mode ?? "balanced";
    const inferred = inferTaskPreset(task);
    await buildPacket(workspaceRoot, task, mode, inferred?.limits);
    return true;
  } catch {
    return false;
  }
}

async function copyLatestForAgent(agentId, workspaceRoot) {
  const agent = AGENT_HANDOFFS[agentId] ?? AGENT_HANDOFFS.codex;
  const handoff = await runCli(["handoff", "--workspace", workspaceRoot, "--format", agent.format]);
  await vscode.env.clipboard.writeText(handoff);
  vscode.window.showInformationMessage(`Context Delta copied the latest packet for ${agent.label}.`);
}

async function getLatestTask(workspaceRoot) {
  try {
    const packet = await readLatestPacket(workspaceRoot);
    return packet.intent?.task ?? "";
  } catch {
    return "";
  }
}

function inferTaskPreset(task) {
  const normalized = String(task).toLowerCase();
  if (/(security|secret|token|auth|permission|role|vulnerab|unsafe|privacy)/.test(normalized)) {
    return PACKET_PRESETS.find((preset) => preset.label === "Security-sensitive");
  }
  if (/(test|debug|failing|failure|regression|coverage)/.test(normalized)) {
    return PACKET_PRESETS.find((preset) => preset.label === "Test/debug");
  }
  if (/(spec|requirement|acceptance|task|plan)/.test(normalized)) {
    return PACKET_PRESETS.find((preset) => preset.label === "Spec-driven change");
  }
  if (/(doc|readme|content|site|page|ui|visual|responsive|layout|css|html|copy)/.test(normalized)) {
    return PACKET_PRESETS.find((preset) => preset.label === "Docs/content review");
  }
  if (/(review|bug|code|change|implementation)/.test(normalized)) {
    return PACKET_PRESETS.find((preset) => preset.label === "Code review");
  }
  return null;
}

function getWorkspaceRoot(options = {}) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    if (!options.quiet) {
      vscode.window.showWarningMessage("Open a workspace before using Context Delta.");
    }
    return null;
  }
  return folder.uri.fsPath;
}

function getLatestPacketPath(workspaceRoot) {
  return path.join(workspaceRoot, ".contextdelta", "packets", "latest.json");
}

async function readLatestPacket(workspaceRoot) {
  return JSON.parse(await fs.readFile(getLatestPacketPath(workspaceRoot), "utf8"));
}

function getPacketItems(packet) {
  return uniqueItems([
    ...packet.changed_artifacts,
    ...packet.supporting_evidence,
    ...packet.governing_constraints,
    ...packet.impacted_neighbors
  ]);
}

function getAllPacketItems(packet) {
  return [...getPacketItems(packet), ...(packet.excluded || [])];
}

function runCli(args) {
  const cliPath = findCliPath();
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [cliPath, ...args], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function findCliPath() {
  const candidates = [
    path.resolve(__dirname, "..", "cli", "bin", "context-delta.js"),
    path.resolve(
      __dirname,
      "vendor",
      "context-delta-engine",
      "packages",
      "cli",
      "bin",
      "context-delta.js"
    )
  ];

  for (const candidate of candidates) {
    try {
      require("node:fs").accessSync(candidate);
      return candidate;
    } catch {
      // Try the next known development or bundled path.
    }
  }

  return candidates[0];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function uniqueItems(items) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const key = [item.type || item.kind || "item", item.path || "unknown", item.heading || ""].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function formatCounts(counts = {}) {
  const entries = Object.entries(counts);
  if (!entries.length) return "none";
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

module.exports = {
  activate,
  deactivate
};
