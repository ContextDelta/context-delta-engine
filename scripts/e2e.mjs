#!/usr/bin/env node
// End-to-end harness: drives the LIVE Context Delta MCP server over JSON-RPC
// (exactly as a coding agent like Copilot would) against a fresh, realistic
// workspace, and asserts that the full pipeline works — packet assembly, the
// source graph (re-exports + transitive), coverage edges, Python imports,
// model-aware tokenization, the baseline spectrum, and the analytics rollup.
//
// Run: npm run e2e   (exits non-zero on any failed check)

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanWorkspace, writeSnapshot } from "../packages/engine/src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpPath = path.join(repoRoot, "packages", "mcp-server", "bin", "context-delta-mcp.js");

const results = [];
function check(label, condition, detail = "") {
  results.push({ label, ok: Boolean(condition), detail });
  const mark = condition ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${label}${detail && !condition ? ` -> ${detail}` : ""}`);
}

async function makeWorkspace() {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "cd-e2e-"));
  const write = async (rel, content) => {
    const full = path.join(ws, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  };
  await write("src/auth/service.ts", "export function login(user: string) {\n  return `${user}:ok`;\n}\n");
  // Re-export barrel (export ... from) — must be resolved by the graph.
  await write("src/auth/index.ts", 'export { login } from "./service";\n');
  // Consumer importing through the barrel — a 2-hop transitive dependent.
  await write("src/app.ts", 'import { login } from "./auth/index";\nexport const run = () => login("admin");\n');
  // Test that imports the changed file directly — a coverage edge.
  await write("tests/auth/service.test.ts", 'import { login } from "../../src/auth/service";\ntest("login", () => { expect(login("a")).toBe("a:ok"); });\n');
  // Python module + pytest test — multi-language graph + coverage.
  await write("payments/charge.py", "def charge(amount):\n    return amount\n");
  await write("tests/test_charge.py", "from payments.charge import charge\n\ndef test_charge():\n    assert charge(5) == 5\n");
  // Spec + instruction so governing constraints + specs appear.
  await write("specs/login/spec.md", "# Login\n\n## Acceptance Criteria\n\n- Users can log in.\n- Sessions are recorded.\n");
  await write("AGENTS.md", "# Agent Instructions\n\nKeep auth changes small and covered by tests.\n");
  return ws;
}

function startServer() {
  const server = spawn(process.execPath, [mcpPath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "inherit"]
  });
  let buffer = "";
  const pending = new Map();
  server.stdout.on("data", (data) => {
    buffer += data;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  let nextId = 1;
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 15000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return { server, rpc };
}

// get_context_packet returns the full packet as JSON text — used for structural
// assertions without writing metrics or disturbing change detection.
async function getPacket(rpc, workspaceRoot, args = {}) {
  const response = await rpc("tools/call", {
    name: "get_context_packet",
    arguments: { workspaceRoot, writeOutputs: false, ...args }
  });
  return JSON.parse(response.result.content[0].text).packet;
}

async function main() {
  const ws = await makeWorkspace();
  const { server, rpc } = startServer();

  try {
    // Establish a snapshot baseline, then make a real change.
    const scan = await scanWorkspace(ws);
    await writeSnapshot(ws, scan.files);
    await fs.appendFile(path.join(ws, "src/auth/service.ts"), "\nexport function logout() {\n  return true;\n}\n");

    console.log("\n# Protocol");
    const init = await rpc("initialize", {});
    check("initialize returns server info", init.result?.serverInfo?.name === "context-delta");
    const tools = await rpc("tools/list", {});
    check("tools/list includes prepare_context", tools.result?.tools?.some((t) => t.name === "prepare_context"));

    console.log("\n# Packet assembly (TS change)");
    const packet = await getPacket(rpc, ws, { task: "harden the login flow" });
    const changed = packet.changed_artifacts.map((i) => i.path);
    const neighbors = packet.impacted_neighbors.map((i) => i.path);
    const tests = packet.supporting_evidence.filter((i) => i.type === "test");
    check("changed file is in the packet", changed.includes("src/auth/service.ts"), JSON.stringify(changed));
    check("re-export barrel resolved as neighbor", neighbors.includes("src/auth/index.ts"), JSON.stringify(neighbors));
    check("transitive (2-hop) consumer resolved", neighbors.includes("src/app.ts"));
    const coveringTs = tests.find((t) => t.path === "tests/auth/service.test.ts");
    check("covering test surfaced with reason", coveringTs && /Covering test/.test(coveringTs.reason));
    check("governing constraint (AGENTS.md) present", packet.governing_constraints.some((i) => i.path === "AGENTS.md"));

    console.log("\n# Tokenizer + baseline spectrum");
    const m = packet.metrics;
    check("exact tokenizer engaged", m.token_count_method === "exact_tokenizer", m.token_count_method);
    check("default encoding is o200k_base", m.tokenizer_encoding === "o200k_base", m.tokenizer_encoding);
    check("baselines present (3)", m.baselines && Object.keys(m.baselines).length === 3);
    check(
      "baseline spectrum is monotonic",
      m.baselines.open_files_only.tokens_estimate <= m.baselines.naive_agent.tokens_estimate &&
        m.baselines.naive_agent.tokens_estimate <= m.baselines.whole_repo.tokens_estimate
    );
    check("delivered < naive baseline (real saving)", m.delivered_tokens_estimate < m.baselines.naive_agent.tokens_estimate);

    console.log("\n# Model override");
    const classic = await getPacket(rpc, ws, { task: "harden the login flow", model: "gpt-4" });
    check("gpt-4 selects cl100k_base", classic.metrics.tokenizer_encoding === "cl100k_base", classic.metrics.tokenizer_encoding);

    console.log("\n# Python graph + coverage");
    await fs.appendFile(path.join(ws, "payments/charge.py"), "\ndef refund(amount):\n    return -amount\n");
    const pyPacket = await getPacket(rpc, ws, { task: "update charge logic" });
    const pyTests = pyPacket.supporting_evidence.filter((i) => i.type === "test").map((i) => i.path);
    check("python pytest covering test surfaced", pyTests.includes("tests/test_charge.py"), JSON.stringify(pyTests));

    console.log("\n# Analytics rollup");
    const metricsPath = path.join(ws, ".contextdelta", "reports", "session-metrics.jsonl");
    const before = await countLines(metricsPath);
    const runs = 3;
    for (let i = 0; i < runs; i += 1) {
      await rpc("tools/call", {
        name: "prepare_context",
        arguments: { workspaceRoot: ws, task: `analytics run ${i}`, writeOutputs: true }
      });
    }
    const after = await countLines(metricsPath);
    check(`each prepare_context appended a metrics event (+${runs})`, after - before === runs, `before=${before} after=${after}`);

    const metricsResponse = await rpc("tools/call", { name: "get_context_metrics", arguments: { workspaceRoot: ws } });
    const summary = JSON.parse(metricsResponse.result.content[0].text);
    check("metrics summary sessions == runs", summary.sessions === runs, `sessions=${summary.sessions}`);
    check("metrics summary tracks tokens saved", Number.isFinite(summary.tokens_saved_estimate) && summary.tokens_saved_estimate >= 0);
    check("metrics summary has average reduction", Number.isFinite(summary.average_context_reduction_percent));
    check("metrics summary has risk mix", summary.risk_counts && Object.keys(summary.risk_counts).length > 0, JSON.stringify(summary.risk_counts));

    const managerResponse = await rpc("tools/call", { name: "generate_manager_summary", arguments: { workspaceRoot: ws } });
    const manager = JSON.parse(managerResponse.result.content[0].text);
    check("manager summary reports sessions", (manager.summary?.sessions ?? manager.sessions) >= runs);
  } finally {
    server.kill();
    await fs.rm(ws, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log("FAILED:", failed.map((f) => f.label).join("; "));
    process.exit(1);
  }
  console.log("E2E: all green.");
}

async function countLines(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.split(/\r?\n/).filter(Boolean).length;
  } catch {
    return 0;
  }
}

main().catch((error) => {
  console.error("E2E harness error:", error);
  process.exit(1);
});
