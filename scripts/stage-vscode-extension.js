#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const source = path.join(root, "packages", "vscode-extension");
const out = path.join(root, "dist", "vscode-extension");
const vendor = path.join(out, "vendor", "context-delta-engine");

await fs.rm(out, { force: true, recursive: true });
await fs.mkdir(out, { recursive: true });

await copyFile("packages/vscode-extension/package.json", "package.json");
await copyFile("packages/vscode-extension/README.md", "README.md");
await copyFile("packages/vscode-extension/CHANGELOG.md", "CHANGELOG.md");
await copyFile("packages/vscode-extension/extension.js", "extension.js");
await copyDir(path.join(source, "resources"), path.join(out, "resources"));

for (const packageName of ["cli", "engine", "shared"]) {
  await copyDir(
    path.join(root, "packages", packageName),
    path.join(vendor, "packages", packageName)
  );
}

await copyFile("LICENSE", path.join("vendor", "context-delta-engine", "LICENSE"));
await copyFile("README.md", path.join("vendor", "context-delta-engine", "README.md"));

console.log(`VS Code extension staged at ${path.relative(root, out)}`);

async function copyFile(fromRelative, toRelative) {
  const from = path.join(root, fromRelative);
  const to = path.isAbsolute(toRelative) ? toRelative : path.join(out, toRelative);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

async function copyDir(from, to) {
  await fs.cp(from, to, {
    filter: (entry) => !entry.includes(`${path.sep}.contextdelta${path.sep}`),
    recursive: true
  });
}
