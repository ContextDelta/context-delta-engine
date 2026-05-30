import fs from "node:fs/promises";
import path from "node:path";
import { estimateTokensForText } from "../../shared/src/index.js";
import { readFileSnippet } from "./scanner.js";

// Catches static imports, bare side-effect imports, re-exports (export ... from),
// dynamic import(), and require(). Re-exports in particular were previously missed,
// which made the graph overlook real dependencies.
const IMPORT_RE =
  /(?:\b(?:import|export)\b[^'"`;]*?\bfrom\s*|^\s*import\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["'`]([^"'`]+)["'`]/gm;
const SYMBOL_RE =
  /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|def)\s+([A-Za-z_$][\w$]*)/g;

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
  const goModule = await readGoModulePath(files);
  const indexed = new Map();

  for (const file of sourceFiles) {
    indexed.set(file.path, await indexSourceFile(file, byPath, { goModule }));
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
  const goModule = await readGoModulePath(files);
  const covering = [];

  for (const test of testFiles) {
    const content = await readFileSnippet(test, { maxChars: options.indexChars ?? 40_000 });
    const imports = resolveImports(test.path, content, byPath, { goModule });
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

async function indexSourceFile(file, byPath, context = {}) {
  const content = await readFileSnippet(file, { maxChars: 40_000 });
  return {
    imports: resolveImports(file.path, content, byPath, context),
    symbols: extractSymbols(content)
  };
}

// Reads the module path from a go.mod, if the workspace has one. Go imports are
// fully-qualified package paths prefixed by this module path; everything else
// (stdlib, third-party) is dropped because it never resolves to a repo file.
async function readGoModulePath(files) {
  const goMod = files.find((file) => file.path === "go.mod" || file.path.endsWith("/go.mod"));
  if (!goMod?.absolutePath) return null;
  try {
    const content = await fs.readFile(goMod.absolutePath, "utf8");
    const match = content.match(/^\s*module\s+(\S+)/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// Resolves an intra-repo Go import to the .go files in the target package
// directory (a Go package is a directory of files, not a single file).
function resolveGoImports(content, byPath, goModule) {
  if (!goModule) return [];
  const prefix = `${goModule}/`;
  const specifiers = [];
  for (const match of content.matchAll(/import\s+(?:\(([\s\S]*?)\)|"([^"]+)")/g)) {
    if (match[2]) specifiers.push(match[2]);
    if (match[1]) {
      for (const line of match[1].split("\n")) {
        const single = line.match(/"([^"]+)"/);
        if (single) specifiers.push(single[1]);
      }
    }
  }

  const resolved = new Set();
  for (const specifier of specifiers) {
    if (!specifier.startsWith(prefix)) continue;
    const packageDir = specifier.slice(prefix.length);
    for (const candidate of byPath.keys()) {
      if (
        candidate.endsWith(".go") &&
        candidate.startsWith(`${packageDir}/`) &&
        !candidate.slice(packageDir.length + 1).includes("/")
      ) {
        resolved.add(candidate);
      }
    }
  }
  return [...resolved];
}

// Language-aware import resolution. Python resolves very differently from the
// JS/TS family (dotted module paths, relative dots, __init__.py packages), so
// dispatch by extension. Anything else falls back to the JS/TS resolver.
function resolveImports(filePath, content, byPath, context = {}) {
  if (filePath.endsWith(".py")) return resolvePythonImports(filePath, content, byPath);
  if (filePath.endsWith(".go")) return resolveGoImports(content, byPath, context.goModule);
  return resolveJsImports(filePath, content, byPath);
}

function resolveJsImports(filePath, content, byPath) {
  const imports = [];
  for (const match of content.matchAll(IMPORT_RE)) {
    const specifier = match[1];
    if (!specifier || !specifier.startsWith(".")) continue;
    const resolved = resolveImportPath(filePath, specifier, byPath);
    if (resolved) imports.push(resolved);
  }
  return [...new Set(imports)];
}

// Resolves intra-repo Python imports. Relative imports (from .mod / from ..pkg)
// resolve against the file's package; absolute imports (import a.b / from a.b
// import c) are tried from the repo root and a common `src/` layout. Anything
// that doesn't resolve to a file already in the repo (stdlib, third-party) is
// dropped automatically because byPath only contains repo files.
const PY_FROM_RE = /^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(.+)$/gm;
const PY_IMPORT_RE = /^[ \t]*import[ \t]+([\w. ,]+)$/gm;

function resolvePythonImports(filePath, content, byPath) {
  const fileDir = path.posix.dirname(filePath);
  const resolved = new Set();

  const tryAdd = (baseDir, dotted) => {
    const relative = dotted.split(".").filter(Boolean).join("/");
    const target = relative ? path.posix.normalize(path.posix.join(baseDir, relative)) : baseDir;
    for (const candidate of [`${target}.py`, `${target}/__init__.py`]) {
      if (byPath.has(candidate)) resolved.add(candidate);
    }
  };

  for (const match of content.matchAll(PY_FROM_RE)) {
    const dots = match[1] ?? "";
    const moduleName = match[2] ?? "";
    const importedNames = (match[3] ?? "")
      .replace(/[()\\]/g, " ")
      .split(",")
      .map((name) => name.trim().split(/\s+as\s+/)[0].trim())
      .filter((name) => name && name !== "*");

    if (dots) {
      let baseDir = fileDir;
      for (let level = 1; level < dots.length; level += 1) baseDir = path.posix.dirname(baseDir);
      if (moduleName) {
        tryAdd(baseDir, moduleName);
      } else {
        for (const name of importedNames) tryAdd(baseDir, name);
      }
    } else if (moduleName) {
      tryAdd("", moduleName);
      tryAdd("src", moduleName);
      for (const name of importedNames) {
        tryAdd("", `${moduleName}.${name}`);
        tryAdd("src", `${moduleName}.${name}`);
      }
    }
  }

  for (const match of content.matchAll(PY_IMPORT_RE)) {
    for (const part of match[1].split(",")) {
      const moduleName = part.trim().split(/\s+as\s+/)[0].trim();
      if (!moduleName) continue;
      tryAdd("", moduleName);
      tryAdd("src", moduleName);
    }
  }

  return [...resolved];
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
