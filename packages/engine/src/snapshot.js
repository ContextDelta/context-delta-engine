import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "../../shared/src/index.js";

const SNAPSHOT_PATH = path.join(".contextdelta", "index", "snapshot.json");

export function snapshotFilePath(workspaceRoot) {
  return path.join(workspaceRoot, SNAPSHOT_PATH);
}

export async function readSnapshot(workspaceRoot) {
  try {
    const raw = await fs.readFile(snapshotFilePath(workspaceRoot), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeSnapshot(workspaceRoot, files) {
  const entries = {};
  for (const file of files.filter((item) => item.textLike && !item.tooLarge)) {
    entries[file.path] = {
      hash: await hashFile(file.absolutePath),
      kind: file.kind,
      mtimeMs: file.mtimeMs,
      size: file.size
    };
  }

  const snapshot = {
    createdAt: nowIso(),
    files: entries,
    schemaVersion: "0.1"
  };

  await fs.mkdir(path.dirname(snapshotFilePath(workspaceRoot)), { recursive: true });
  await fs.writeFile(snapshotFilePath(workspaceRoot), `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

export async function detectSnapshotChanges(workspaceRoot, files) {
  const snapshot = await readSnapshot(workspaceRoot);

  if (!snapshot?.files) {
    return {
      changedPaths: inferRecentFiles(files),
      hasSnapshot: false,
      strategy: "local-snapshot:first-run"
    };
  }

  const changedPaths = [];
  const currentPaths = new Set();

  for (const file of files.filter((item) => item.textLike && !item.tooLarge)) {
    currentPaths.add(file.path);
    const previous = snapshot.files[file.path];
    if (!previous) {
      changedPaths.push(file.path);
      continue;
    }

    if (previous.size !== file.size) {
      changedPaths.push(file.path);
      continue;
    }

    if (previous.hash !== (await hashFile(file.absolutePath))) {
      changedPaths.push(file.path);
    }
  }

  for (const previousPath of Object.keys(snapshot.files)) {
    if (!currentPaths.has(previousPath)) changedPaths.push(previousPath);
  }

  return {
    changedPaths: [...new Set(changedPaths)],
    hasSnapshot: true,
    strategy: "local-snapshot"
  };
}

async function hashFile(absolutePath) {
  const content = await fs.readFile(absolutePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function inferRecentFiles(files) {
  return files
    .filter((file) => file.textLike && !file.tooLarge && file.kind !== "other")
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 12)
    .map((file) => file.path);
}

