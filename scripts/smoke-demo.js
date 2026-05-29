#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const cli = path.join(root, "packages", "cli", "bin", "context-delta.js");
const workspace = path.join(root, "examples", "demo-workspace");

run(["doctor", "--workspace", workspace]);
run(["packet", "Add admin refresh token rotation", "--workspace", workspace, "--report"]);
run(["packet", "Add admin refresh token rotation", "--workspace", workspace, "--pin", "docs/missing-runbook.md"]);

const insights = parseJson(run(["insights", "--workspace", workspace, "--json"]));
const compact = parseJson(run(["compact", "--workspace", workspace, "--json"]));
const history = parseJson(run(["history", "--workspace", workspace, "--json"]));
const diff = parseJson(run(["diff", "--workspace", workspace, "--json"]));
const summary = parseJson(run(["summary", "--workspace", workspace, "--json"]));
const handoff = run(["handoff", "--workspace", workspace, "--format", "copilot"]);

assert(insights.risk_level, "insights should include risk level");
assert(compact.id, "compact packet should include id");
assert(history.history?.length >= 2, "history should include at least two packets");
assert(Number.isFinite(diff.summary?.added_count), "diff should include added_count");
assert(summary.summary?.sessions >= 2, "summary should include sessions");
assert(handoff.includes("Context Delta Handoff For GitHub Copilot"), "handoff should render Copilot text");

console.log("Context Delta demo smoke passed.");

function run(args) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
}

function parseJson(value) {
  return JSON.parse(value);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
