import fs from "node:fs/promises";
import { estimateTokensForText } from "../../shared/src/index.js";

const MAX_SECTION_CHARS = 8_000;

export async function findRelevantMarkdownSections(files, keywords, options = {}) {
  const limit = options.limit ?? 8;
  const markdownFiles = files.filter(
    (file) =>
      ["doc", "instruction", "spec"].includes(file.kind) &&
      file.textLike &&
      !file.tooLarge &&
      file.extension === ".md"
  );

  const sections = [];

  for (const file of markdownFiles) {
    const parsed = await parseMarkdownSections(file);
    for (const section of parsed) {
      const score = scoreSection(file, section, keywords);
      if (score <= 0 && file.kind !== "instruction") continue;
      sections.push({
        ...section,
        fileKind: file.kind,
        path: file.path,
        score,
        tokensEstimate: estimateTokensForText(section.content)
      });
    }
  }

  return sections
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.path.localeCompare(b.path);
    })
    .slice(0, limit);
}

export async function parseMarkdownSections(file) {
  const raw = await fs.readFile(file.absolutePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const sections = [];
  let current = {
    content: "",
    heading: "Document start",
    level: 0,
    lineStart: 1
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);

    if (heading && current.content.trim()) {
      sections.push(trimSection(current));
      current = {
        content: `${line}\n`,
        heading: heading[2].trim(),
        level: heading[1].length,
        lineStart: index + 1
      };
      continue;
    }

    if (heading && !current.content.trim()) {
      current.heading = heading[2].trim();
      current.level = heading[1].length;
      current.lineStart = index + 1;
    }

    current.content += `${line}\n`;
  }

  if (current.content.trim()) sections.push(trimSection(current));
  return sections;
}

// Spec->code traceability: surfaces spec sections that explicitly reference the
// changed files (by path or basename) or changed symbols, even when task
// keywords do not match them. Completes the spec/code/test edge triad alongside
// the source graph's coverage edges.
export async function findSpecTraceLinks(files, changedPaths, changedSymbols = [], options = {}) {
  const limit = options.limit ?? 4;
  const needles = buildTraceNeedles(changedPaths, changedSymbols);
  if (needles.length === 0) return [];

  const specFiles = files.filter(
    (file) => file.kind === "spec" && file.textLike && !file.tooLarge && file.extension === ".md"
  );

  const links = [];
  for (const file of specFiles) {
    const sections = await parseMarkdownSections(file);
    for (const section of sections) {
      const haystack = `${section.heading}\n${section.content}`.toLowerCase();
      const hits = needles.filter((needle) => haystack.includes(needle.value));
      if (hits.length === 0) continue;
      links.push({
        content: section.content,
        heading: section.heading,
        line_start: section.lineStart,
        path: file.path,
        reason: `Spec traces to changed code (references ${hits.slice(0, 2).map((hit) => hit.label).join(", ")})`,
        score: 40 + hits.reduce((total, hit) => total + hit.weight, 0),
        tokens_estimate: estimateTokensForText(section.content),
        type: "spec_section"
      });
    }
  }

  return links.sort((left, right) => right.score - left.score).slice(0, limit);
}

function buildTraceNeedles(changedPaths, changedSymbols) {
  const needles = new Map();
  const add = (value, label, weight) => {
    const key = value.toLowerCase();
    if (key.length < 3) return;
    if (!needles.has(key)) needles.set(key, { value: key, label, weight });
  };

  for (const changedPath of changedPaths) {
    const noExt = changedPath.replace(/\.[^./]+$/, "");
    const segments = noExt.split("/");
    add(noExt, changedPath, 12); // full path reference is the strongest trace
    if (segments.length >= 2) add(segments.slice(-2).join("/"), segments.slice(-2).join("/"), 10);
    const base = segments[segments.length - 1] ?? "";
    if (base.length >= 5) add(base, base, 6); // distinctive basename only
  }
  for (const symbol of changedSymbols) {
    if (symbol && symbol.length >= 4) add(symbol, symbol, 8);
  }
  return [...needles.values()];
}

function trimSection(section) {
  const content = section.content.trim();
  return {
    ...section,
    content:
      content.length > MAX_SECTION_CHARS
        ? `${content.slice(0, MAX_SECTION_CHARS)}\n\n[Context Delta truncated section]`
        : content
  };
}

function scoreSection(file, section, keywords) {
  let score = file.kind === "instruction" ? 18 : 0;
  const haystack = `${file.path} ${section.heading} ${section.content.slice(0, 4_000)}`.toLowerCase();

  for (const keyword of keywords) {
    if (file.path.toLowerCase().includes(keyword)) score += 9;
    if (section.heading.toLowerCase().includes(keyword)) score += 8;
    if (haystack.includes(keyword)) score += 3;
  }

  if (file.kind === "spec") score += 10;
  if (file.kind === "instruction") score += 8;
  if (/requirement|acceptance|constraint|security|must|should/i.test(section.heading)) score += 4;

  return score;
}

