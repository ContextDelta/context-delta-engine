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

