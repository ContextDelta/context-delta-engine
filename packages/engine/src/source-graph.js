import path from "node:path";
import { estimateTokensForText } from "../../shared/src/index.js";
import { readFileSnippet } from "./scanner.js";

// Catches static imports, bare side-effect imports, re-exports (export ... from),
// dynamic import(), and require(). Re-exports in particular were previously missed,
// which made the graph overlook real dependencies.
const IMPORT_RE =
  /(?:\b(?:import|export)\b[^'"`;]*?\bfrom\s*|^\s*import\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["'`]([^"'`]+)["'`]/gm;
const SYMBOL_RE =
  /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/g;

export async function findSourceGraphNeighbors(files, changedPaths, keywords, options = {}) {
  const limit = options.limit ?? 8;
  const snippetChars = options.snippetChars ?? 10_000;
  // Hops of transitive impact to follow. 1 = only direct importers/dependencies
  // (the old behavior); 2 captures indirect impact (the file that imports the
  // file that imports a changed file) at a decayed weight. Deterministic and
  // local — no LLM, no embeddings.
  const maxHops = Math.max(1, options.maxHops ?? 2);
  const sourceFiles = files.filter((file) => file.kind === "source" && file.textLike && !file.tooLarge);
  const byPath = new Map(sourceFiles.map((file) => [file.path, file]));
  const indexed = new Map();

  for (const file of sourceFiles) {
    indexed.set(file.path, await indexSourceFile(file, byPath));
  }

  // Build the directed import graph and its reverse (dependents).
  const dependencies = new Map(); // file -> files it imports (within the repo)
  const dependents = new Map(); // file -> files that import it
  for (const file of sourceFiles) {
    const imports = indexed.get(file.path)?.imports ?? [];
    dependencies.set(file.path, new Set(imports));
    for (const target of imports) {
      if (!dependents.has(target)) dependents.set(target, new Set());
      dependents.get(target).add(file.path);
    }
  }

  const changed = [...changedPaths].filter((filePath) => byPath.has(filePath));
  const changedSymbols = new Set(changed.flatMap((filePath) => indexed.get(filePath)?.symbols ?? []));

  // Transitive BFS in both directions from the changed set, with per-hop decay.
  const impact = new Map(); // path -> { score, minHop, reasons[] }
  traverseImpact(changed, dependents, impact, {
    maxHops,
    baseWeight: 30,
    label: "depends on changed code"
  });
  traverseImpact(changed, dependencies, impact, {
    maxHops,
    baseWeight: 35,
    label: "dependency of changed code"
  });

  const neighbors = [];
  for (const file of sourceFiles) {
    if (changedPaths.has(file.path)) continue;
    const index = indexed.get(file.path);
    const reasons = [];
    let score = 0;

    const transitive = impact.get(file.path);
    if (transitive) {
      score += transitive.score;
      reasons.push(...transitive.reasons.slice(0, 2));
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
      graph_distance: transitive?.minHop ?? null,
      graph_reason: reasons,
      kind: file.kind,
      path: file.path,
      reason: `Source graph neighbor: ${reasons.join("; ")}.`,
      score: Number(score.toFixed(2)),
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

// Breadth-first traversal of the import graph from the changed seeds. Each hop
// further out contributes a smaller (halved) score, and the closest hop to a
// changed file wins for a given node, so direct impact outranks indirect impact.
function traverseImpact(seeds, adjacency, impact, { maxHops, baseWeight, label }) {
  const visited = new Set(seeds);
  let frontier = new Set(seeds);

  for (let hop = 1; hop <= maxHops; hop += 1) {
    const next = new Set();
    const weight = baseWeight * 0.5 ** (hop - 1);
    for (const node of frontier) {
      for (const neighbor of adjacency.get(node) ?? []) {
        if (visited.has(neighbor)) continue;
        next.add(neighbor);
        const entry = impact.get(neighbor) ?? { score: 0, minHop: Infinity, reasons: [] };
        entry.score += weight;
        if (hop < entry.minHop) entry.minHop = hop;
        entry.reasons.push(`${label} (${hop} hop${hop > 1 ? "s" : ""})`);
        impact.set(neighbor, entry);
      }
    }
    for (const node of next) visited.add(node);
    frontier = next;
    if (frontier.size === 0) break;
  }
}

// Coverage edges: tests that directly IMPORT a target source file (e.g. a
// changed file) are the tests that actually exercise it — far more reliable
// than keyword matching, which can miss a test or pull in unrelated ones. This
// mirrors the test/coverage edges in deterministic repo-graph approaches
// (RIG, CodeRAG). Returns covering test files scored by how many targets they hit.
export async function findCoveringTests(files, targetPaths, options = {}) {
  const targets = new Set(targetPaths);
  if (targets.size === 0) return [];

  const eligible = files.filter((file) => file.textLike && !file.tooLarge);
  const byPath = new Map(eligible.map((file) => [file.path, file]));
  const testFiles = eligible.filter((file) => file.kind === "test");
  const covering = [];

  for (const test of testFiles) {
    const content = await readFileSnippet(test, { maxChars: options.indexChars ?? 40_000 });
    const imports = resolveImports(test.path, content, byPath);
    const covers = imports.filter((importPath) => targets.has(importPath));
    if (covers.length === 0) continue;
    covering.push({
      file: test,
      covers,
      reason: `Covering test: imports changed code (${covers.slice(0, 2).join(", ")})`,
      score: 60 + covers.length * 10
    });
  }

  return covering.sort((left, right) => right.score - left.score);
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
    const specifier = match[1];
    if (!specifier || !specifier.startsWith(".")) continue;
    const resolved = resolveImportPath(filePath, specifier, byPath);
    if (resolved) imports.push(resolved);
  }
  return [...new Set(imports)];
}

const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts", ".vue", ".svelte", ".json"];

function resolveImportPath(filePath, specifier, byPath) {
  const baseDir = path.posix.dirname(filePath);
  const bare = path.posix.normalize(path.posix.join(baseDir, specifier));
  const candidates = [
    ...RESOLVE_EXTENSIONS.map((extension) => `${bare}${extension}`),
    ...RESOLVE_EXTENSIONS.filter(Boolean).map((extension) => `${bare}/index${extension}`)
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
