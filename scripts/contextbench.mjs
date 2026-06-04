#!/usr/bin/env node
// ContextBench — runs the labeled gold set and emits a reproducible scorecard.
// This is the citable benchmark for "did the context packet contain the right
// things": impact coverage (did required files get in), omission rate (what was
// missed), useful-context density (signal vs noise), and forbidden inclusions
// (did stale/irrelevant files leak). Token reduction is reported as a secondary
// cost signal, never the headline.
//
// Usage: node scripts/contextbench.mjs [--write]   (--write updates docs/contextbench-scorecard.md)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPacketEval } from "../packages/engine/src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evalRoot = path.join(repoRoot, "examples", "eval");
const write = process.argv.includes("--write");

// Best-effort language/shape label per case id, for a readable scorecard.
const SHAPE = {
  "auth-refresh-rotation-demo": "TypeScript · auth",
  "static-site-responsive-review": "HTML/CSS/JS · static site",
  "node-service-validation": "JavaScript · service",
  "python-payments-validation": "Python · service",
  "ts-notifications-retry": "TypeScript · barrel re-export",
  "go-billing-validation": "Go · module-aware",
  "ts-inventory-reorder-precision": "TypeScript · precision (decoys)",
  "rust-billing-validation": "Rust · mod/use crate",
  "ts-pricing-supersession": "TypeScript · spec supersession"
};

function scorecard(report) {
  const s = report.summary;
  const lines = [
    "# ContextBench Scorecard",
    "",
    "_Reproduce: `npm run contextbench`. This file is generated; do not edit by hand._",
    "",
    "## Aggregate",
    "",
    "| Metric | Result |",
    "| --- | --- |",
    `| Cases | ${s.cases} |`,
    `| Passed | ${s.passed} / ${s.cases} (${s.pass_rate_percent}%) |`,
    `| Impact coverage (avg) | ${s.average_impact_coverage_percent}% |`,
    `| Omission rate (avg) | ${s.average_omission_rate_percent}% |`,
    `| Useful-context density (avg) | ${s.average_useful_context_density_percent}% |`,
    `| Whole-workspace reduction (avg) | ${s.average_workspace_reduction_percent}% |`,
    `| Avg packet size | ${s.average_packet_tokens_estimate} tokens |`,
    "",
    "## Per case",
    "",
    "| Case | Shape | Status | Coverage | Omission | Density | Forbidden |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.results.map((r) =>
      `| ${r.case_id} | ${SHAPE[r.case_id] ?? "—"} | ${r.passed ? "pass" : "FAIL"} | ` +
      `${r.impact_coverage_percent}% | ${r.omission_rate_percent}% | ${r.useful_context_density_percent}% | ` +
      `${r.forbidden_included.length} |`
    ),
    "",
    "## What the metrics mean",
    "",
    "- **Impact coverage** — required files included ÷ required files. Did the right context get in?",
    "- **Omission rate** — required files missed ÷ required files. The failure mode that breaks tasks.",
    "- **Useful-context density** — required-or-acceptable files ÷ all included files. Signal vs noise.",
    "- **Forbidden** — stale/irrelevant files that leaked in. Should be zero.",
    "- **Reduction** — secondary cost signal, not the headline.",
    ""
  ];
  return lines.join("\n");
}

async function main() {
  const { report } = await runPacketEval(evalRoot, { casesPath: "multi-shape-gold-set.json" });
  const s = report.summary;

  console.log("ContextBench");
  console.log("");
  console.log(`Cases:        ${s.passed}/${s.cases} passed (${s.pass_rate_percent}%)`);
  console.log(`Coverage:     ${s.average_impact_coverage_percent}%   Omission: ${s.average_omission_rate_percent}%`);
  console.log(`Density:      ${s.average_useful_context_density_percent}%   Reduction: ${s.average_workspace_reduction_percent}%`);
  console.log(`Avg packet:   ${s.average_packet_tokens_estimate} tokens`);

  if (write) {
    const out = path.join(repoRoot, "docs", "contextbench-scorecard.md");
    await fs.writeFile(out, `${scorecard(report)}`);
    console.log(`\nWrote ${path.relative(repoRoot, out)}`);
  }

  const failed = report.results.filter((r) => !r.passed);
  if (failed.length) {
    console.log(`\nFAILED: ${failed.map((r) => r.case_id).join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("ContextBench error:", error);
  process.exit(1);
});
