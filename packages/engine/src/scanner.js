import fs from "node:fs/promises";
import path from "node:path";
import { normalizeRelativePath, toPosixPath } from "../../shared/src/index.js";
import {
  classifyFile,
  isTextLikeFile,
  shouldIgnoreDirectory,
  shouldIgnoreFile
} from "./file-kinds.js";

const DEFAULT_MAX_FILE_BYTES = 1_000_000;

export async function scanWorkspace(workspaceRoot, options = {}) {
  const root = path.resolve(workspaceRoot);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const files = [];
  const ignored = [];

  async function walk(directory) {
    const entries = await safeReadDir(directory);
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizeRelativePath(path.relative(root, absolutePath));

      if (entry.isDirectory()) {
        if (shouldIgnoreDirectory(entry.name)) {
          ignored.push({ path: relativePath, reason: "ignored directory" });
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (shouldIgnoreFile(entry.name)) {
        ignored.push({ path: relativePath, reason: "ignored lock/generated file" });
        continue;
      }

      const stat = await fs.stat(absolutePath);
      const kind = classifyFile(relativePath);
      const textLike = isTextLikeFile(relativePath);
      const tooLarge = stat.size > maxFileBytes;

      files.push({
        absolutePath,
        extension: path.extname(entry.name).toLowerCase(),
        kind,
        mtimeMs: stat.mtimeMs,
        path: toPosixPath(relativePath),
        size: stat.size,
        textLike,
        tooLarge
      });

      if (tooLarge) {
        ignored.push({ path: relativePath, reason: `larger than ${maxFileBytes} bytes` });
      } else if (!textLike) {
        ignored.push({ path: relativePath, reason: "not text-like" });
      }
    }
  }

  await walk(root);

  files.sort((a, b) => a.path.localeCompare(b.path));
  ignored.sort((a, b) => a.path.localeCompare(b.path));

  return {
    files,
    ignored,
    root
  };
}

async function safeReadDir(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function readFileSnippet(file, options = {}) {
  const maxChars = options.maxChars ?? 12_000;
  if (!file.textLike || file.tooLarge) return "";
  const raw = await fs.readFile(file.absolutePath, "utf8");
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n\n[Context Delta truncated ${raw.length - maxChars} characters]`;
}

