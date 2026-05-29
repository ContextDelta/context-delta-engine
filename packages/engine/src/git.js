import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeRelativePath } from "../../shared/src/index.js";

const execFileAsync = promisify(execFile);

export async function getGitState(workspaceRoot) {
  const inside = await runGit(workspaceRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return {
      available: false,
      changedPaths: [],
      reason: inside.stderr || inside.error || "not a git repository"
    };
  }

  const resolvedWorkspaceRoot = await realpathSafe(workspaceRoot);
  const rootResult = await runGit(workspaceRoot, ["rev-parse", "--show-toplevel"]);
  const gitRoot = rootResult.ok ? await realpathSafe(rootResult.stdout.trim()) : resolvedWorkspaceRoot;
  const branchResult = await runGit(workspaceRoot, ["branch", "--show-current"]);
  const statusResult = await runGit(workspaceRoot, ["status", "--porcelain=v1", "-uall", "--", "."]);

  const changedPaths = statusResult.ok
    ? parsePorcelainStatus(statusResult.stdout, gitRoot, resolvedWorkspaceRoot)
    : [];

  return {
    available: true,
    branch: branchResult.ok ? branchResult.stdout.trim() || "detached" : "unknown",
    changedPaths,
    root: gitRoot
  };
}

async function realpathSafe(value) {
  try {
    return await fs.realpath(value);
  } catch {
    return path.resolve(value);
  }
}

export async function getGitDiffForPath(workspaceRoot, relativePath, maxChars = 10_000) {
  const result = await runGit(workspaceRoot, ["diff", "--", relativePath]);
  if (!result.ok || !result.stdout.trim()) return "";
  if (result.stdout.length <= maxChars) return result.stdout;
  return `${result.stdout.slice(0, maxChars)}\n\n[Context Delta truncated git diff]`;
}

async function runGit(cwd, args) {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      error: error.message
    };
  }
}

function parsePorcelainStatus(stdout, gitRoot, workspaceRoot) {
  const paths = [];
  const workspacePrefix = normalizeRelativePath(pathRelative(gitRoot, workspaceRoot));

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const rawPath = line.slice(3).trim();
    const renamedPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) : rawPath;
    if (!renamedPath) continue;

    const normalized = normalizeRelativePath(renamedPath);
    if (!workspacePrefix || workspacePrefix === ".") {
      paths.push(normalized);
      continue;
    }

    if (normalized === workspacePrefix) {
      paths.push("");
    } else if (normalized.startsWith(`${workspacePrefix}/`)) {
      paths.push(normalized.slice(workspacePrefix.length + 1));
    }
  }

  return [...new Set(paths.filter(Boolean))];
}

function pathRelative(from, to) {
  return normalizeRelativePath(path.relative(from, to));
}
