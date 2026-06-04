#!/usr/bin/env node
// Builds a packet for each bundled example workspace and validates it against the
// packet contract (packages/engine/src/packet-schema.js). A failure means the
// package structure drifted — caught before anyone downstream relies on it.
//
// Usage: node scripts/validate-packet.mjs

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContextPacket, validatePacket } from "../packages/engine/src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
  { task: "Add refresh token rotation for admin users", workspace: "examples/demo-workspace" },
  { task: "Reject zero or negative invoice amounts in the billing service", workspace: "examples/eval/go-service-workspace" },
  { task: "Cap promotional discounts at 50 percent", workspace: "examples/eval/ts-pricing-workspace" }
];

async function main() {
  let failures = 0;
  for (const target of TARGETS) {
    const { packet } = await buildContextPacket({
      task: target.task,
      updateSnapshot: false,
      workspaceRoot: path.join(repoRoot, target.workspace)
    });
    const { valid, errors } = validatePacket(packet);
    if (valid) {
      console.log(`  [PASS] ${target.workspace}`);
    } else {
      failures += 1;
      console.log(`  [FAIL] ${target.workspace}`);
      for (const error of errors) console.log(`         - ${error}`);
    }
  }
  if (failures) {
    console.log(`\nPacket contract validation failed for ${failures} workspace(s).`);
    process.exit(1);
  }
  console.log("\nPacket contract: all packets valid.");
}

main().catch((error) => {
  console.error("validate-packet error:", error);
  process.exit(1);
});
