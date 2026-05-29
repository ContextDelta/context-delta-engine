#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];

await checkRequiredFiles();
await checkRootPackage();
await checkWorkspacePackages();
await checkVsCodeManifest();
await checkCiWorkflow();
await checkDocs();

if (failures.length) {
  console.error("Context Delta release validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Context Delta release validation passed.");
}

async function checkRequiredFiles() {
  const files = [
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "contextdelta.config.example.json",
    "docs/cli.md",
    "docs/docs-index.md",
    "docs/eval.md",
    "docs/eval.html",
    "docs/index.html",
    "docs/blog.html",
    "docs/blog-context-packets.html",
    "docs/blog-local-first-ai-context.html",
    "docs/blog-spec-driven-ai-coding.html",
    "docs/cli.html",
    "docs/docs.html",
    "docs/eval.html",
    "docs/github-copilot.html",
    "docs/metrics.html",
    "docs/mcp-client-setup.html",
    "docs/release.html",
    "docs/spec-kit.html",
    "docs/vscode-extension.html",
    "docs/launch-checklist.md",
    "docs/release.md",
    "docs/robots.txt",
    "docs/sitemap.xml",
    "docs/site/index.html",
    "docs/site/assets/context-savings-preview.svg",
    "docs/site/assets/metrics-rollup-preview.svg",
    "docs/site/assets/packet-preview.svg",
    "docs/site/assets/vscode-dashboard-preview.svg",
    "docs/site/site.js",
    "examples/demo-workspace/README.md",
    "packages/cli/bin/context-delta.js",
    "packages/mcp-server/bin/context-delta-mcp.js",
    "packages/vscode-extension/extension.js",
    "packages/vscode-extension/package.json",
    "packages/vscode-extension/README.md",
    "packages/vscode-extension/CHANGELOG.md"
  ];

  for (const file of files) {
    if (!(await exists(file))) failures.push(`Missing required file: ${file}`);
  }
}

async function checkRootPackage() {
  const pkg = await readJson("package.json");
  for (const field of ["name", "version", "description", "license", "repository", "bugs", "homepage"]) {
    if (!pkg[field]) failures.push(`Root package.json missing '${field}'.`);
  }

  const scripts = [
    "approve",
    "check",
    "context-delta",
    "controls",
    "drift",
    "eval",
    "prepare",
    "release:check",
    "smoke",
    "setup",
    "syntax",
    "test",
    "validate:release",
    "replay",
    "vscode:stage"
  ];
  for (const script of scripts) {
    if (!pkg.scripts?.[script]) failures.push(`Root package.json missing script '${script}'.`);
  }

  if (!pkg.bin?.["context-delta"]) failures.push("Root package.json missing context-delta bin.");
  if (!pkg.bin?.["context-delta-mcp"]) failures.push("Root package.json missing context-delta-mcp bin.");
}

async function checkWorkspacePackages() {
  const packageFiles = [
    "packages/cli/package.json",
    "packages/engine/package.json",
    "packages/mcp-server/package.json",
    "packages/shared/package.json"
  ];

  for (const packageFile of packageFiles) {
    const pkg = await readJson(packageFile);
    for (const field of ["name", "version", "description", "license", "repository"]) {
      if (!pkg[field]) failures.push(`${packageFile} missing '${field}'.`);
    }
  }
}

async function checkVsCodeManifest() {
  const pkg = await readJson("packages/vscode-extension/package.json");
  for (const field of ["name", "displayName", "description", "version", "publisher", "license", "repository", "homepage"]) {
    if (!pkg[field]) failures.push(`VS Code package.json missing '${field}'.`);
  }

  if (!pkg.preview) failures.push("VS Code package should be marked preview for alpha readiness.");
  if (!pkg.contributes?.viewsContainers?.activitybar?.length) {
    failures.push("VS Code package missing activity bar view container.");
  }

  const activationEvents = new Set(pkg.activationEvents ?? []);
  for (const command of pkg.contributes?.commands ?? []) {
    const event = `onCommand:${command.command}`;
    if (!activationEvents.has(event)) {
      failures.push(`VS Code command '${command.command}' lacks activation event.`);
    }
  }
}

async function checkCiWorkflow() {
  const ci = await readText(".github/workflows/ci.yml");
  if (!ci.includes("npm run release:check")) {
    failures.push("CI does not run npm run release:check.");
  }
}

async function checkDocs() {
  const readme = await readText("README.md");
  for (const phrase of ["context packet layer", "Spec Kit", "GitHub Copilot", "MCP", "VS Code", "packet-quality eval"]) {
    if (!readme.includes(phrase)) failures.push(`README missing positioning phrase: ${phrase}`);
  }
  for (const asset of ["context-savings-preview.svg", "vscode-dashboard-preview.svg", "metrics-rollup-preview.svg"]) {
    if (!readme.includes(asset)) failures.push(`README missing launch visual: ${asset}`);
  }
  await checkMarkdownLinks("README.md");
  await checkMarkdownLinks("docs/docs-index.md");

  const pages = await readText("docs/index.html");
  for (const phrase of ["context packet layer for AI coding agents", "Apache-2.0 open source", "GitHub Copilot", "Spec Kit", "MCP", "VS Code", "context-savings-preview.svg", "vscode-dashboard-preview.svg", "metrics-rollup-preview.svg"]) {
    if (!pages.includes(phrase)) failures.push(`Pages landing page missing phrase: ${phrase}`);
  }

  await checkPagesLinks([
    "docs/index.html",
    "docs/blog.html",
    "docs/blog-context-packets.html",
    "docs/blog-local-first-ai-context.html",
    "docs/blog-spec-driven-ai-coding.html",
    "docs/cli.html",
    "docs/docs.html",
    "docs/eval.html",
    "docs/github-copilot.html",
    "docs/metrics.html",
    "docs/mcp-client-setup.html",
    "docs/release.html",
    "docs/spec-kit.html",
    "docs/vscode-extension.html"
  ]);

  const blog = await readText("docs/blog.html");
  for (const phrase of ["Context Delta Blog", "context packets", "local-first", "spec-driven"]) {
    if (!blog.includes(phrase)) failures.push(`Blog index missing phrase: ${phrase}`);
  }

  const robots = await readText("docs/robots.txt");
  if (!robots.includes("sitemap.xml")) failures.push("robots.txt missing sitemap reference.");

  const sitemap = await readText("docs/sitemap.xml");
  for (const url of ["blog.html", "eval.html", "github-copilot.html", "mcp-client-setup.html", "spec-kit.html"]) {
    if (!sitemap.includes(url)) failures.push(`sitemap.xml missing URL: ${url}`);
  }

  const extensionReadme = await readText("packages/vscode-extension/README.md");
  for (const phrase of ["activity bar", "Packet Diff", "Agent Handoff"]) {
    if (!extensionReadme.includes(phrase)) {
      failures.push(`VS Code README missing phrase: ${phrase}`);
    }
  }
}

async function checkMarkdownLinks(markdownFile) {
  const markdown = await readText(markdownFile);
  const refs = [...markdown.matchAll(/!?\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);

  for (const ref of refs) {
    if (
      ref.startsWith("#") ||
      ref.startsWith("http://") ||
      ref.startsWith("https://") ||
      ref.startsWith("mailto:")
    ) {
      continue;
    }

    const cleanRef = ref.split("#")[0].split("?")[0];
    if (!cleanRef) continue;

    const resolved = path.normalize(path.join(path.dirname(markdownFile), cleanRef));
    if (!(await exists(resolved))) {
      failures.push(`${markdownFile} has missing Markdown link or asset: ${ref}`);
    }
  }
}

async function checkPagesLinks(pageFiles) {
  for (const pageFile of pageFiles) {
    const html = await readText(pageFile);
    const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]);

    for (const ref of refs) {
      if (
        ref.startsWith("#") ||
        ref.startsWith("http://") ||
        ref.startsWith("https://") ||
        ref.startsWith("mailto:")
      ) {
        continue;
      }

      const cleanRef = ref.split("#")[0].split("?")[0];
      if (!cleanRef) continue;

      const resolved = path.normalize(path.join(path.dirname(pageFile), cleanRef));
      if (!resolved.startsWith("docs/")) {
        failures.push(`${pageFile} links outside docs: ${ref}`);
      } else if (!(await exists(resolved))) {
        failures.push(`${pageFile} has missing local link or asset: ${ref}`);
      }
    }
  }
}

async function exists(relativePath) {
  try {
    await fs.access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}
