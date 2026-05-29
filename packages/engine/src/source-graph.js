import path from "node:path";
import { estimateTokensForText } from "../../shared/src/index.js";
import { readFileSnippet } from "./scanner.js";

const IMPORT_RE = /\bimport\s+(?:[^'"`]+?\s+from\s+)?["'`]([^"'`]+)["'`]|require\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
const SYMBOL_RE =
  /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/g;

export async function findSourceGraphNeighbors(files, changedPaths, keywords, options = {}) {
  const limit = options.limit ?? 8;
  const snippetChars = options.snippetChars ?? 10_000;
  const sourceFiles = files.filter((file) => file.kind === "source" && file.textLike && !file.tooLarge);
  const byPath = new Map(sourceFiles.map((file) => [file.path, file]));
  const indexed = new Map();

  for (const file of sourceFiles) {
    indexed.set(file.path, await indexSourceFile(file, byPath));
  }

  const changed = [...changedPaths].filter((filePath) => byPath.has(filePath));
  const changedSymbols = new Set(changed.flatMap((filePath) => indexed.get(filePath)?.symbols ?? []));
  const neighbors = [];

  for (const file of sourceFiles) {
    if (changedPaths.has(file.path)) continue;
    const index = indexed.get(file.path);
    const reasons = [];
    let score = 0;

    const importsChanged = index.imports.filter((importPath) => changedPaths.has(importPath));
    if (importsChanged.length) {
      score += importsChanged.length * 35;
      reasons.push(`imports changed path ${importsChanged.slice(0, 2).join(", ")}`);
    }

    const importedByChanged = changed.filter((changedPath) =>
      indexed.get(changedPath)?.imports.includes(file.path)
    );
    if (importedByChanged.length) {
      score += importedByChanged.length * 30;
      reasons.push(`imported by changed path ${importedByChanged.slice(0, 2).join(", ")}`);
    }

    const sharedSymbols = index.symbols.filter((symbol) =>
      [...changedSymbols].some((changedSymbol) => sharesSymbolStem(symbol, changedSymbol))
    );
    if (sharedSymbols.length) {
      score += Math.min(sharedSymbols.length * 8, 24);
      reasons.push(`shares symbol language around ${sharedSymbols.slice(0, 3).join(", ")}`);
    }

    const sameDirectory = changed.filter(
      (changedPath) => path.posix.dirname(changedPath) === path.posix.dirname(file.path)
    );
    if (sameDirectory.length) {
      score += 12;
      reasons.push("same directory as changed source");
    }

    const keywordMatches = keywords.filter((keyword) => file.path.toLowerCase().includes(keyword));
    if (keywordMatches.length) {
      score += keywordMatches.length * 10;
      reasons.push(`path matches ${keywordMatches.join(", ")}`);
    }

    if (score <= 0) continue;
    const content = await readFileSnippet(file, { maxChars: snippetChars });
    neighbors.push({
      content,
      graph_reason: reasons,
      kind: file.kind,
      path: file.path,
      reason: `Source graph neighbor: ${reasons.join("; ")}.`,
      score,
      tokens_estimate: estimateTokensForText(content),
      type: "graph_neighbor"
    });
  }

  return neighbors
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.path.localeCompare(right.path);
    })
    .slice(0, limit);
}

async function indexSourceFile(file, byPath) {
  const content = await readFileSnippet(file, { maxChars: 40_000 });
  return {
    imports: resolveImports(file.path, content, byPath),
    symbols: extractSymbols(content)
  };
}

function resolveImports(filePath, content, byPath) {
  const imports = [];
  for (const match of content.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2];
    if (!specifier || !specifier.startsWith(".")) continue;
    const resolved = resolveImportPath(filePath, specifier, byPath);
    if (resolved) imports.push(resolved);
  }
  return [...new Set(imports)];
}

function resolveImportPath(filePath, specifier, byPath) {
  const baseDir = path.posix.dirname(filePath);
  const bare = path.posix.normalize(path.posix.join(baseDir, specifier));
  const candidates = [
    bare,
    `${bare}.ts`,
    `${bare}.tsx`,
    `${bare}.js`,
    `${bare}.jsx`,
    `${bare}/index.ts`,
    `${bare}/index.tsx`,
    `${bare}/index.js`,
    `${bare}/index.jsx`
  ];

  return candidates.find((candidate) => byPath.has(candidate)) ?? null;
}

function extractSymbols(content) {
  return [...content.matchAll(SYMBOL_RE)].map((match) => match[1]).slice(0, 80);
}

function sharesSymbolStem(left, right) {
  if (!left || !right || left === right) return left === right;
  const leftStem = left.toLowerCase().replace(/service|store|client|controller|handler|manager/g, "");
  const rightStem = right.toLowerCase().replace(/service|store|client|controller|handler|manager/g, "");
  return leftStem.length > 3 && rightStem.length > 3 && leftStem === rightStem;
}
