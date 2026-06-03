import fs from "node:fs/promises";
import path from "node:path";

// A practical .gitignore / .deltaignore subset: comments, negation (!),
// directory-only (trailing /), anchored (leading / or embedded /) vs
// basename patterns, and *, **, ? globs. Read at the workspace root so behavior
// is predictable; a .deltaignore can add project-specific ignores on top of the
// repo's .gitignore.

export async function loadIgnoreRules(root) {
  const rules = [];
  for (const name of [".gitignore", ".deltaignore"]) {
    try {
      rules.push(...compileIgnore(await fs.readFile(path.join(root, name), "utf8")));
    } catch {
      // No such ignore file — fine.
    }
  }
  return rules;
}

export function compileIgnore(content) {
  const rules = [];
  for (const raw of String(content).split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let pattern = trimmed;
    const negate = pattern.startsWith("!");
    if (negate) pattern = pattern.slice(1);
    const dirOnly = pattern.endsWith("/");
    if (dirOnly) pattern = pattern.replace(/\/+$/, "");
    if (!pattern) continue;
    const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
    if (pattern.startsWith("/")) pattern = pattern.slice(1);
    rules.push({ dirOnly, negate, regex: globToRegex(pattern, anchored) });
  }
  return rules;
}

function globToRegex(pattern, anchored) {
  let re = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 1;
      } else {
        re += "[^/]*";
      }
    } else if (char === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(char)) {
      re += `\\${char}`;
    } else {
      re += char;
    }
  }
  return new RegExp(anchored ? `^${re}$` : `(?:^|/)${re}$`);
}

// Tests a workspace-relative posix path against the rules. Each ancestor segment
// is checked too, so a directory rule (e.g. "build/") ignores everything under
// it. Later rules win (gitignore precedence), so a negation can re-include.
export function isIgnored(relativePath, rules) {
  if (!rules || rules.length === 0) return false;
  const parts = relativePath.split("/");
  let ignored = false;
  for (const rule of rules) {
    let matched = false;
    for (let end = 1; end <= parts.length; end += 1) {
      const isAncestorDir = end < parts.length;
      if (rule.dirOnly && !isAncestorDir) continue; // dir-only never matches a leaf file directly
      if (rule.regex.test(parts.slice(0, end).join("/"))) {
        matched = true;
        break;
      }
    }
    if (matched) ignored = !rule.negate;
  }
  return ignored;
}
