#!/usr/bin/env node
// Local performance benchmark for Context Delta. Measures the work that happens
// on every task — workspace scan, relevance index, and full packet assembly —
// against a synthetic repo of a given size, and prints a markdown table. These
// are wall-clock numbers on the current machine; run `npm run benchmark` to
// reproduce. No network, no model calls.
//
// Usage: node scripts/benchmark.mjs [--files N] [--runs R]

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildContextPacket, scanWorkspace } from "../packages/engine/src/index.js";

const args = process.argv.slice(2);
const fileCount = numberFlag(args, "--files", 1000);
const runs = numberFlag(args, "--runs", 5);

function numberFlag(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
}

async function makeRepo(fileCount) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cd-bench-"));
  const modules = Math.max(1, Math.floor(fileCount / 4));
  for (let i = 0; i < modules; i += 1) {
    const dir = path.join(root, "src", `mod${i}`);
    await fs.mkdir(dir, { recursive: true });
    const dep = i > 0 ? `import { run as run${i - 1} } from "../mod${i - 1}/service";\n` : "";
    await fs.writeFile(
      path.join(dir, "service.ts"),
      `${dep}export function run${i}(x: number) {\n  return x * ${i + 1};\n}\n`
    );
    await fs.writeFile(
      path.join(dir, "service.test.ts"),
      `import { run${i} } from "./service";\ntest("run${i}", () => { expect(run${i}(1)).toBe(${i + 1}); });\n`
    );
    await fs.writeFile(path.join(dir, "README.md"), `# Module ${i}\n\nDocs for module ${i}.\n`);
    await fs.writeFile(path.join(dir, "config.json"), `{ "id": ${i} }\n`);
  }
  await fs.writeFile(path.join(root, "AGENTS.md"), "# Agent Instructions\n\nKeep changes small and tested.\n");
  await fs.mkdir(path.join(root, "specs", "core"), { recursive: true });
  await fs.writeFile(path.join(root, "specs", "core", "spec.md"), "# Core Spec\n\n## Requirement\n\nModules multiply inputs.\n");
  return root;
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    mean: sum / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  };
}

async function time(fn) {
  const start = performance.now();
  const result = await fn();
  return { ms: performance.now() - start, result };
}

async function main() {
  const root = await makeRepo(fileCount);
  try {
    const scanSamples = [];
    const packetSamples = [];
    let scanned = 0;
    let packetTokens = 0;

    // warm-up
    await scanWorkspace(root);

    for (let i = 0; i < runs; i += 1) {
      const scan = await time(() => scanWorkspace(root));
      scanSamples.push(scan.ms);
      scanned = scan.result.files.length;

      const packet = await time(() =>
        buildContextPacket({
          task: "update module multiply logic and cover with a test",
          updateSnapshot: false,
          workspaceRoot: root
        })
      );
      packetSamples.push(packet.ms);
      packetTokens = packet.result.packet.metrics.packet_tokens_estimate;
    }

    const scan = stats(scanSamples);
    const packet = stats(packetSamples);
    const fmt = (n) => `${n.toFixed(1)} ms`;

    console.log(`Context Delta benchmark — ${scanned} files, ${runs} runs (Node ${process.version})`);
    console.log("");
    console.log("| Stage | mean | p50 | p95 |");
    console.log("| --- | --- | --- | --- |");
    console.log(`| Workspace scan + classify | ${fmt(scan.mean)} | ${fmt(scan.p50)} | ${fmt(scan.p95)} |`);
    console.log(`| Full packet assembly (scan + graph + index + rank + tokenize) | ${fmt(packet.mean)} | ${fmt(packet.p50)} | ${fmt(packet.p95)} |`);
    console.log("");
    console.log(`Packet size: ~${packetTokens} tokens. All local, deterministic, no model calls.`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Benchmark error:", error);
  process.exit(1);
});
