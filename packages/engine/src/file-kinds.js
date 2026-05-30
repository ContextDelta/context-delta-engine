import path from "node:path";
import { normalizeRelativePath } from "../../shared/src/index.js";

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".html",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".m",
  ".mm",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scala",
  ".svg",
  ".swift",
  ".ts",
  ".tsx"
]);

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".txt", ".adoc"]);
const CONFIG_EXTENSIONS = new Set([".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini"]);

export const DEFAULT_IGNORE_DIRS = new Set([
  ".cache",
  ".contextdelta",
  ".git",
  ".hg",
  ".next",
  ".nuxt",
  ".pnpm-store",
  ".svn",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor"
]);

export const DEFAULT_IGNORE_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock"
]);

export function classifyFile(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const lower = normalized.toLowerCase();
  const basename = path.posix.basename(lower);
  const extension = path.posix.extname(lower);

  if (isInstructionFile(lower, basename)) return "instruction";
  if (isSpecFile(lower, basename)) return "spec";
  if (isTestFile(lower, basename)) return "test";
  if (DOC_EXTENSIONS.has(extension)) return "doc";
  if (SOURCE_EXTENSIONS.has(extension)) return "source";
  if (CONFIG_EXTENSIONS.has(extension)) return "config";
  return "other";
}

export function shouldIgnoreDirectory(name) {
  return DEFAULT_IGNORE_DIRS.has(name);
}

export function shouldIgnoreFile(name) {
  return DEFAULT_IGNORE_FILES.has(name);
}

export function isTextLikeFile(relativePath) {
  const kind = classifyFile(relativePath);
  return ["config", "doc", "instruction", "source", "spec", "test"].includes(kind);
}

function isInstructionFile(lower, basename) {
  if (
    [
      "agents.md",
      "claude.md",
      "copilot-instructions.md",
      "gemini.md",
      "instructions.md"
    ].includes(basename)
  ) {
    return true;
  }

  return (
    lower.startsWith(".github/instructions/") ||
    lower.startsWith(".cursor/rules/") ||
    lower.includes("/.cursor/rules/") ||
    lower.includes("copilot-instructions") ||
    lower.includes("agent-instructions") ||
    lower.includes("/instructions/")
  );
}

function isSpecFile(lower, basename) {
  if (["spec.md", "plan.md", "tasks.md"].includes(basename)) return true;
  if (lower.startsWith("specs/") || lower.includes("/specs/")) return true;
  if (lower.startsWith(".specify/") || lower.includes("/.specify/")) return true;
  if (lower.includes("spec-driven") || lower.includes("spec_")) return true;
  return false;
}

function isTestFile(lower, basename) {
  if (lower.includes("/tests/") || lower.includes("/__tests__/")) return true;
  return (
    basename.includes(".test.") ||
    basename.includes(".spec.") ||
    basename.endsWith("_test.go") ||
    basename.endsWith("_test.py") ||
    (basename.startsWith("test_") && basename.endsWith(".py")) ||
    basename.endsWith("test.py") ||
    basename.endsWith("tests.py")
  );
}
