import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getGitState } from "./git.js";
import { scanWorkspace } from "./scanner.js";
import { writeDefaultConfig } from "./config.js";

const execFileAsync = promisify(execFile);

const VSCODE_EXTENSION_ID = "contextdelta.context-delta-vscode";
const VSCODE_EXTENSION_FOLDER = `${VSCODE_EXTENSION_ID}-0.1.0`;

export async function getSetupStatus(workspaceRoot, options = {}) {
  const root = path.resolve(workspaceRoot);
  const target = normalizeSetupTarget(options.target);
  const requiredChecks = requiredCheckNames(target);
  const checks = [];
  const scan = await scanWorkspace(root);
  const git = await getGitState(root);
  const configPath = path.join(root, "contextdelta.config.json");
  const latestPacketPath = path.join(root, ".contextdelta", "packets", "latest.json");
  const vscodeCli = await findVsCodeCli();
  const extensionInfo = await getVsCodeExtensionInfo();
  const mcpInfo = await getVsCodeMcpInfo(root);
  const mcpServerPath = path.join(root, "packages", "mcp-server", "bin", "context-delta-mcp.js");

  checks.push(check("workspace", true, `${scan.files.length} files scanned`));
  checks.push(check("node", isNodeVersionAtLeast(20), `Node ${process.versions.node}`, "Install Node.js 20 or newer."));
  checks.push(check("git", git.available, git.available ? `git on ${git.branch ?? "unknown"}` : "git unavailable", "Use git or run snapshot for local change detection."));
  checks.push(check("config", await exists(configPath), "contextdelta.config.json", "Run context-delta setup --fix or context-delta init."));
  checks.push(check("latest_packet", await exists(latestPacketPath), ".contextdelta/packets/latest.json", "Run context-delta prepare \"your task\"."));
  checks.push(check("mcp_server", await exists(mcpServerPath), path.relative(root, mcpServerPath), "Install package files or run from the repo root."));
  checks.push(check("vscode_cli", Boolean(vscodeCli), vscodeCli ?? "not found", "Install the VS Code shell command or use the app-bundled code binary."));
  checks.push(check("vscode_extension", extensionInfo.installed, extensionInfo.path ?? "not installed", "Run npm run vscode:stage, then context-delta setup --fix."));
  checks.push(check("vscode_mcp", mcpInfo.registered, mcpInfo.path, "Run context-delta setup --fix to add the Context Delta MCP server."));

  const annotatedChecks = checks.map((item) => ({
    ...item,
    optional: !requiredChecks.has(item.name)
  }));

  const status = annotatedChecks.every((item) => item.ok || item.optional)
    ? "ready"
    : "needs-attention";

  return {
    checks: annotatedChecks,
    counts: {
      docs: scan.files.filter((file) => file.kind === "doc").length,
      instructions: scan.files.filter((file) => file.kind === "instruction").length,
      source: scan.files.filter((file) => file.kind === "source").length,
      specs: scan.files.filter((file) => file.kind === "spec").length,
      tests: scan.files.filter((file) => file.kind === "test").length
    },
    fix_available: true,
    mcp: {
      config_path: mcpInfo.path,
      registered: mcpInfo.registered,
      server_path: mcpServerPath,
      server: buildVsCodeMcpServer(root)
    },
    status,
    target,
    target_label: setupTargetLabel(target),
    vscode: {
      cli: vscodeCli,
      extension_installed: extensionInfo.installed,
      extension_path: extensionInfo.path ?? null
    },
    workspace_root: root
  };
}

export async function applySetupFixes(workspaceRoot, options = {}) {
  const root = path.resolve(workspaceRoot);
  const target = normalizeSetupTarget(options.target);
  const actions = [];

  const config = await writeDefaultConfig(root, { force: false });
  actions.push({
    changed: config.created,
    message: config.created ? "Created contextdelta.config.json." : "Config already exists.",
    path: config.path,
    type: "config"
  });

  if (["all", "vscode"].includes(target)) {
    const extensionAction = await installStagedVsCodeExtension(root);
    actions.push(extensionAction);
  }

  if (target === "all") {
    const mcpAction = await writeVsCodeMcpConfig(root);
    actions.push(mcpAction);
  }

  if (target === "mcp") {
    actions.push({
      changed: false,
      message: "MCP server is repo-local. Run `npm run doctor -- --mcp` to copy host-specific config.",
      path: path.join(root, "packages", "mcp-server", "bin", "context-delta-mcp.js"),
      type: "mcp-server"
    });
  }

  return {
    actions,
    status: await getSetupStatus(root, { ...options, target })
  };
}

export function renderSetupMarkdown(status) {
  const lines = [
    "# Context Delta Setup",
    "",
    `Workspace: ${status.workspace_root}`,
    `Target: ${status.target_label ?? setupTargetLabel(status.target)}`,
    `Status: ${status.status}`,
    "",
    "## Checks",
    "",
    ...status.checks.map((item) => {
      const marker = item.ok ? "[ok]" : item.optional ? "[optional]" : "[fix]";
      return `- ${marker} ${item.label}: ${item.detail}${item.ok || item.optional ? "" : ` (${item.fix})`}`;
    }),
    "",
    "## Next Best Action",
    "",
    renderSetupNextAction(status),
    "",
    "## Normal Workflow",
    "",
    "1. Ask your agent normally.",
    "2. Let the agent call `prepare_context`, or run `npm run prepare -- \"your task\"`.",
    "3. Use `npm run drift` after edits when you want to check whether the agent moved outside the packet.",
    "4. Open the full packet only when risk or drift says review is needed."
  ];

  return `${lines.join("\n")}\n`;
}

function buildVsCodeMcpServer(workspaceRoot) {
  return {
    command: process.execPath,
    args: [path.join(workspaceRoot, "packages", "mcp-server", "bin", "context-delta-mcp.js")],
    env: {
      CONTEXT_DELTA_WORKSPACE: workspaceRoot
    }
  };
}

async function writeVsCodeMcpConfig(workspaceRoot) {
  const mcpPath = vscodeMcpPath();
  const server = buildVsCodeMcpServer(workspaceRoot);
  let config = {
    inputs: [],
    servers: {}
  };

  try {
    config = JSON.parse(await fs.readFile(mcpPath, "utf8"));
  } catch {
    // Create a new VS Code MCP config.
  }

  const previous = JSON.stringify(config.servers?.["context-delta"] ?? null);
  config.servers = {
    ...(config.servers ?? {}),
    "context-delta": server
  };
  if (!Array.isArray(config.inputs)) config.inputs = [];

  await fs.mkdir(path.dirname(mcpPath), { recursive: true });
  await fs.writeFile(mcpPath, `${JSON.stringify(config, null, 2)}\n`);

  return {
    changed: previous !== JSON.stringify(server),
    message: "Registered Context Delta MCP server for VS Code.",
    path: mcpPath,
    type: "mcp"
  };
}

async function installStagedVsCodeExtension(workspaceRoot) {
  const staged = path.join(workspaceRoot, "dist", "vscode-extension");
  const target = path.join(vscodeExtensionsDir(), VSCODE_EXTENSION_FOLDER);

  if (!(await exists(staged))) {
    return {
      changed: false,
      message: "No staged VS Code extension found. Run npm run vscode:stage first.",
      path: staged,
      type: "vscode-extension"
    };
  }

  await fs.rm(target, { force: true, recursive: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(staged, target, { recursive: true });

  return {
    changed: true,
    message: "Installed staged VS Code extension.",
    path: target,
    type: "vscode-extension"
  };
}

async function getVsCodeMcpInfo(workspaceRoot) {
  const mcpPath = vscodeMcpPath();
  try {
    const config = JSON.parse(await fs.readFile(mcpPath, "utf8"));
    const server = config.servers?.["context-delta"];
    const registered =
      Boolean(server?.command) &&
      JSON.stringify(server).includes(path.join(workspaceRoot, "packages", "mcp-server"));
    return {
      path: mcpPath,
      registered
    };
  } catch {
    return {
      path: mcpPath,
      registered: false
    };
  }
}

async function getVsCodeExtensionInfo() {
  const extensionRoot = vscodeExtensionsDir();
  try {
    const entries = await fs.readdir(extensionRoot, { withFileTypes: true });
    const entry = entries.find((item) => item.isDirectory() && item.name.startsWith(VSCODE_EXTENSION_ID));
    return {
      installed: Boolean(entry),
      path: entry ? path.join(extensionRoot, entry.name) : null
    };
  } catch {
    return {
      installed: false,
      path: null
    };
  }
}

async function findVsCodeCli() {
  const candidates = [
    process.env.CONTEXT_DELTA_VSCODE_CLI,
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    path.join(os.homedir(), "Desktop", "Visual Studio Code.app", "Contents", "Resources", "app", "bin", "code")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await executableWorks(candidate)) return candidate;
  }

  try {
    const { stdout } = await execFileAsync("which", ["code"]);
    const candidate = stdout.trim();
    if (candidate && (await executableWorks(candidate))) return candidate;
  } catch {
    // The shell command is not installed.
  }

  return null;
}

async function executableWorks(candidate) {
  try {
    await fs.access(candidate);
    await execFileAsync(candidate, ["--version"], { maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

function check(name, ok, detail, fix = "") {
  return {
    detail,
    fix,
    label: name.replaceAll("_", " "),
    name,
    ok,
    optional: false
  };
}

function normalizeSetupTarget(target = "all") {
  if (["cli", "mcp", "vscode", "all"].includes(target)) return target;
  return "all";
}

function requiredCheckNames(target) {
  const base = ["workspace", "node"];
  if (target === "cli") return new Set(base);
  if (target === "mcp") return new Set([...base, "mcp_server"]);
  if (target === "vscode") return new Set([...base, "vscode_extension"]);
  return new Set([...base, "mcp_server", "vscode_extension", "vscode_mcp"]);
}

function setupTargetLabel(target) {
  if (target === "cli") return "CLI handoff";
  if (target === "mcp") return "MCP agent integration";
  if (target === "vscode") return "VS Code extension";
  return "All local integrations";
}

function renderSetupNextAction(status) {
  if (status.status === "ready") {
    if (status.target === "mcp") {
      return "Connect an MCP-capable agent and let it call `prepare_context` before coding, reviewing, or debugging.";
    }
    if (status.target === "vscode") {
      return "Use the Context Delta status bar or dashboard to prepare current changes for your preferred agent.";
    }
    if (status.target === "cli") {
      return "Run `npm run prepare -- \"your task\"` when you want a prompt-ready handoff.";
    }
    return "Use your agent normally with `prepare_context`, or run `npm run prepare -- \"your task\"` for a manual handoff.";
  }

  const targetFlag = status.target && status.target !== "all" ? ` --target ${status.target}` : "";
  return `Run \`npm run setup -- --fix${targetFlag}\`, then rerun \`npm run setup --${targetFlag}\`.`;
}

function isNodeVersionAtLeast(major) {
  return Number(process.versions.node.split(".")[0]) >= major;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function vscodeExtensionsDir() {
  return path.join(os.homedir(), ".vscode", "extensions");
}

function vscodeMcpPath() {
  return path.join(os.homedir(), "Library", "Application Support", "Code", "User", "mcp.json");
}
