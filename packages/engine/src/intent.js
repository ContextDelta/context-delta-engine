import fs from "node:fs/promises";
import path from "node:path";
import { getGitState } from "./git.js";

export async function inferWorkspaceIntent(workspaceRoot) {
  const git = await getGitState(workspaceRoot);
  const latestTask = await readLatestTask(workspaceRoot);
  const changedPaths = git.changedPaths ?? [];
  const branch = git.branch && !["main", "master", "trunk", "unknown"].includes(git.branch)
    ? git.branch
    : "";

  if (changedPaths.length) {
    const profile = summarizeChangedPaths(changedPaths);
    const branchPart = branch ? ` on ${branch}` : "";
    return `Review the current ${profile} changes${branchPart}.`;
  }

  if (branch) {
    return `Review the current work on ${branch}.`;
  }

  if (latestTask) {
    return `Continue the previous Context Delta task: ${latestTask}`;
  }

  return "Review the current workspace changes.";
}

function summarizeChangedPaths(paths) {
  const counts = {
    code: 0,
    docs: 0,
    tests: 0,
    config: 0,
    web: 0
  };

  for (const changedPath of paths) {
    const normalized = changedPath.toLowerCase();
    if (/\.(test|spec)\.[jt]sx?$|(^|\/)(test|tests|__tests__)\//.test(normalized)) {
      counts.tests += 1;
    } else if (/\.md$|(^|\/)docs\//.test(normalized)) {
      counts.docs += 1;
    } else if (/\.(html|css|scss|sass)$|(^|\/)(public|site)\//.test(normalized)) {
      counts.web += 1;
    } else if (/\.json$|\.ya?ml$|\.toml$|\.ini$|(^|\/)\.github\//.test(normalized)) {
      counts.config += 1;
    } else {
      counts.code += 1;
    }
  }

  const top = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([, left], [, right]) => right - left)
    .map(([kind]) => kind);

  if (!top.length) return "workspace";
  if (top.includes("tests") && top.includes("code")) return "code and test";
  if (top.includes("web")) return "web/UI";
  if (top.includes("docs")) return "documentation";
  if (top.includes("config")) return "configuration";
  return top[0];
}

async function readLatestTask(workspaceRoot) {
  try {
    const packetPath = path.join(workspaceRoot, ".contextdelta", "packets", "latest.json");
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
    return packet.intent?.task ?? "";
  } catch {
    return "";
  }
}
