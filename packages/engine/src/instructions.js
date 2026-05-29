import path from "node:path";
import { estimateTokensForText } from "../../shared/src/index.js";
import { readFileSnippet } from "./scanner.js";

const INSTRUCTION_TOOL_NAMES = [
  ["agents.md", "agents"],
  ["claude.md", "claude"],
  ["copilot-instructions.md", "github-copilot"],
  ["gemini.md", "gemini"],
  ["instructions.md", "generic"]
];

export async function findApplicableInstructions(files, relevantPaths, keywords, options = {}) {
  const limit = options.limit ?? 8;
  const snippetChars = options.snippetChars ?? 10_000;
  const instructionFiles = files
    .filter((file) => file.kind === "instruction" && file.textLike && !file.tooLarge)
    .map((file) => ({
      file,
      metadata: getInstructionMetadata(file.path)
    }));

  const scoped = instructionFiles.map(({ file, metadata }) => {
    const applicablePaths = [...relevantPaths].filter((candidatePath) =>
      instructionAppliesToPath(metadata, candidatePath)
    );
    const keywordMatches = keywords.filter((keyword) => file.path.toLowerCase().includes(keyword));
    const score =
      20 +
      metadata.precedence * 8 +
      applicablePaths.length * 10 +
      keywordMatches.length * 6 +
      (metadata.scope === "." ? 1 : 0);

    return {
      applicablePaths,
      file,
      keywordMatches,
      metadata,
      score
    };
  });

  const selected = applyClosestWins(scoped, relevantPaths)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.file.path.localeCompare(right.file.path);
    })
    .slice(0, limit);

  return Promise.all(
    selected.map(async ({ applicablePaths, file, metadata }) => {
      const content = await readFileSnippet(file, { maxChars: snippetChars });
      return {
        applies_to: applicablePaths.slice(0, 8),
        content,
        instruction_scope: metadata.scope,
        instruction_tool: metadata.tool,
        kind: file.kind,
        path: file.path,
        precedence: metadata.precedence,
        reason: buildInstructionReason(metadata, applicablePaths),
        tokens_estimate: estimateTokensForText(content),
        type: "instruction_file"
      };
    })
  );
}

export function buildInstructionWarnings(instructionItems) {
  const warnings = [];
  const byTool = new Map();

  for (const item of instructionItems) {
    const key = item.instruction_tool ?? "generic";
    byTool.set(key, [...(byTool.get(key) ?? []), item]);
  }

  for (const [tool, items] of byTool) {
    if (items.length <= 1) continue;
    const scopes = items.map((item) => item.instruction_scope ?? ".").join(", ");
    warnings.push({
      message: `${items.length} ${tool} instruction files apply. Context Delta sorted them by closest-file-wins precedence: ${scopes}.`,
      type: "instruction-precedence"
    });
  }

  const allText = instructionItems
    .map((item) => `${item.path}\n${item.content ?? ""}`.toLowerCase())
    .join("\n\n");
  if (/\balways\b/.test(allText) && /\bnever\b/.test(allText)) {
    warnings.push({
      message: "Instruction files contain both 'always' and 'never' language; review governing constraints before handoff.",
      type: "instruction-review"
    });
  }

  return warnings;
}

export function getInstructionMetadata(relativePath) {
  const normalized = String(relativePath).replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  const basename = path.posix.basename(lower);
  const directory = path.posix.dirname(normalized);
  const scope = getInstructionScope(lower, directory);
  const tool = INSTRUCTION_TOOL_NAMES.find(([name]) => basename === name)?.[1] ?? inferTool(lower);
  const precedence = scope === "." ? 0 : scope.split("/").filter(Boolean).length;

  return {
    precedence,
    scope,
    tool
  };
}

function applyClosestWins(items, relevantPaths) {
  if (!relevantPaths.size) return items;

  const winners = new Set();
  const fallbackItems = [];

  for (const targetPath of relevantPaths) {
    const applicable = items
      .filter((item) => instructionAppliesToPath(item.metadata, targetPath))
      .sort((left, right) => {
        if (right.metadata.precedence !== left.metadata.precedence) {
          return right.metadata.precedence - left.metadata.precedence;
        }
        return left.file.path.localeCompare(right.file.path);
      });

    for (const item of applicable.slice(0, 2)) {
      winners.add(item.file.path);
    }
  }

  for (const item of items) {
    if (winners.has(item.file.path)) continue;
    if (item.metadata.scope === "." || item.applicablePaths.length > 0) fallbackItems.push(item);
  }

  return [
    ...items.filter((item) => winners.has(item.file.path)),
    ...fallbackItems.sort((left, right) => right.score - left.score).slice(0, 3)
  ];
}

function instructionAppliesToPath(metadata, candidatePath) {
  const normalized = String(candidatePath).replaceAll("\\", "/");
  if (!normalized) return true;
  if (metadata.scope === ".") return true;
  return normalized === metadata.scope || normalized.startsWith(`${metadata.scope}/`);
}

function getInstructionScope(lower, directory) {
  if (lower.startsWith(".github/") || lower.startsWith(".cursor/")) return ".";
  if (directory === ".") return ".";
  return directory;
}

function inferTool(lower) {
  if (lower.includes("copilot")) return "github-copilot";
  if (lower.includes("claude")) return "claude";
  if (lower.includes("cursor")) return "cursor";
  if (lower.includes("agents")) return "agents";
  return "generic";
}

function buildInstructionReason(metadata, applicablePaths) {
  const scope = metadata.scope === "." ? "workspace" : metadata.scope;
  const applies =
    applicablePaths.length > 0
      ? ` Applies to ${applicablePaths.length} selected path${applicablePaths.length === 1 ? "" : "s"}.`
      : "";
  return `${metadata.tool} instruction for ${scope} scope, ordered by closest-file-wins precedence.${applies}`;
}
