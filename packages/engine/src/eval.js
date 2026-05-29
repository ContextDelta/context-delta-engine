import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "../../shared/src/index.js";
import { buildContextPacket, getUniqueIncludedItems } from "./packet.js";
import { writeEvent } from "./observability.js";

const DEFAULT_CASES_PATHS = [
  "eval/gold-set.json",
  "eval/context-delta-gold.json",
  ".contextdelta/eval/gold-set.json"
];

export async function runPacketEval(workspaceRoot, options = {}) {
  const casesPath = await resolveCasesPath(workspaceRoot, options.casesPath);
  const suite = JSON.parse(await fs.readFile(casesPath, "utf8"));
  const cases = Array.isArray(suite) ? suite : suite.cases ?? [];
  const casesDir = path.dirname(casesPath);
  const results = [];

  for (const testCase of cases) {
    const caseWorkspaceRoot = resolveCaseWorkspaceRoot(workspaceRoot, casesDir, testCase.workspace);
    const { packet } = await buildContextPacket({
      exclude: testCase.exclude ?? [],
      limits: testCase.limits,
      mode: testCase.mode,
      pin: testCase.pin ?? [],
      task: testCase.task,
      target: "eval",
      updateSnapshot: false,
      workspaceRoot: caseWorkspaceRoot
    });
    results.push(scorePacketAgainstCase(packet, testCase, caseWorkspaceRoot));
  }

  const report = {
    cases_path: casesPath,
    generated_at: nowIso(),
    results,
    summary: summarizeEvalResults(results),
    suite: {
      description: suite.description ?? null,
      name: suite.name ?? "Context Delta packet-quality eval",
      version: suite.version ?? "0.1"
    },
    workspace_root: workspaceRoot
  };

  let outputPaths = null;
  if (options.writeOutputs === true) {
    outputPaths = await writeEvalReport(workspaceRoot, report);
  }

  await writeEvent(workspaceRoot, "packet_eval_completed", {
    cases: results.length,
    pass_rate_percent: report.summary.pass_rate_percent,
    useful_context_density_percent: report.summary.average_useful_context_density_percent
  });

  return {
    output_paths: outputPaths,
    report
  };
}

export function scorePacketAgainstCase(packet, testCase, workspaceRoot = packet.workspace?.root) {
  const included = getUniqueIncludedItems(packet);
  const includedPaths = new Set(included.map((item) => item.path).filter(Boolean));
  const expected = normalizePathList(
    testCase.expected_paths ??
      testCase.minimum_context?.paths ??
      testCase.expected?.included_paths ??
      []
  );
  const acceptable = normalizePathList(
    testCase.acceptable_paths ?? testCase.minimum_context?.acceptable_paths ?? []
  );
  const forbidden = normalizePathList(
    testCase.forbidden_paths ?? testCase.expected?.forbidden_paths ?? []
  );
  const useful = included.filter(
    (item) => expected.includes(item.path) || acceptable.includes(item.path)
  );
  const matchedExpected = expected.filter((expectedPath) => includedPaths.has(expectedPath));
  const missedExpected = expected.filter((expectedPath) => !includedPaths.has(expectedPath));
  const forbiddenIncluded = forbidden.filter((forbiddenPath) => includedPaths.has(forbiddenPath));
  const includedCount = included.length || 1;
  const expectedCount = expected.length || 1;
  const usefulContextDensity = useful.length / includedCount;
  const impactCoverage = matchedExpected.length / expectedCount;
  const omissionRate = missedExpected.length / expectedCount;
  const precision = useful.length / includedCount;
  const passCriteria = {
    max_forbidden: testCase.pass?.max_forbidden ?? 0,
    max_omission_rate: testCase.pass?.max_omission_rate ?? 0.25,
    min_impact_coverage: testCase.pass?.min_impact_coverage ?? 0.75,
    min_useful_context_density: testCase.pass?.min_useful_context_density ?? 0.35
  };
  const passed =
    impactCoverage >= passCriteria.min_impact_coverage &&
    usefulContextDensity >= passCriteria.min_useful_context_density &&
    omissionRate <= passCriteria.max_omission_rate &&
    forbiddenIncluded.length <= passCriteria.max_forbidden;

  return {
    case_id: testCase.id,
    expected_paths: expected,
    forbidden_included: forbiddenIncluded,
    impact_coverage_percent: toPercent(impactCoverage),
    included_paths: [...includedPaths].sort(),
    missed_expected_paths: missedExpected,
    omission_rate_percent: toPercent(omissionRate),
    packet_id: packet.id,
    packet_tokens_estimate: packet.metrics?.packet_tokens_estimate ?? 0,
    pass_criteria: passCriteria,
    passed,
    precision_percent: toPercent(precision),
    task: testCase.task,
    useful_context_density_percent: toPercent(usefulContextDensity),
    workspace: testCase.workspace ?? null,
    workspace_root: workspaceRoot ?? null,
    whole_workspace_reduction_percent: packet.metrics?.context_reduction_percent ?? 0
  };
}

export async function writeEvalReport(workspaceRoot, report) {
  const evalDir = path.join(workspaceRoot, ".contextdelta", "eval");
  await fs.mkdir(evalDir, { recursive: true });
  const jsonPath = path.join(evalDir, "latest-eval.json");
  const markdownPath = path.join(evalDir, "latest-eval.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(markdownPath, renderEvalMarkdown(report));
  return {
    jsonPath,
    markdownPath
  };
}

export function renderEvalMarkdown(report) {
  const summary = report.summary;
  return [
    "# Context Delta Packet-Quality Eval",
    "",
    `Generated: ${report.generated_at}`,
    `Suite: ${report.suite.name}`,
    "",
    "## Summary",
    "",
    `- Cases: ${summary.cases}`,
    `- Passed: ${summary.passed}`,
    `- Pass rate: ${summary.pass_rate_percent}%`,
    `- Useful-context density: ${summary.average_useful_context_density_percent}%`,
    `- Impact coverage: ${summary.average_impact_coverage_percent}%`,
    `- Omission rate: ${summary.average_omission_rate_percent}%`,
    `- Average packet size: ${summary.average_packet_tokens_estimate} tokens`,
    "",
    "## Cases",
    "",
    ...report.results.flatMap((result) => [
      `### ${result.case_id}`,
      "",
      `- Status: ${result.passed ? "passed" : "failed"}`,
      `- Task: ${result.task}`,
      `- Workspace: ${result.workspace ?? result.workspace_root ?? "default"}`,
      `- Useful-context density: ${result.useful_context_density_percent}%`,
      `- Impact coverage: ${result.impact_coverage_percent}%`,
      `- Missed expected paths: ${result.missed_expected_paths.join(", ") || "none"}`,
      `- Forbidden included: ${result.forbidden_included.join(", ") || "none"}`,
      ""
    ])
  ].join("\n");
}

function summarizeEvalResults(results) {
  const cases = results.length;
  const passed = results.filter((result) => result.passed).length;
  const totals = results.reduce(
    (accumulator, result) => {
      accumulator.density += result.useful_context_density_percent;
      accumulator.coverage += result.impact_coverage_percent;
      accumulator.omission += result.omission_rate_percent;
      accumulator.packetTokens += result.packet_tokens_estimate;
      accumulator.workspaceReduction += result.whole_workspace_reduction_percent;
      return accumulator;
    },
    {
      coverage: 0,
      density: 0,
      omission: 0,
      packetTokens: 0,
      workspaceReduction: 0
    }
  );

  return {
    average_impact_coverage_percent: average(totals.coverage, cases),
    average_omission_rate_percent: average(totals.omission, cases),
    average_packet_tokens_estimate: cases ? Math.round(totals.packetTokens / cases) : 0,
    average_useful_context_density_percent: average(totals.density, cases),
    average_workspace_reduction_percent: average(totals.workspaceReduction, cases),
    cases,
    pass_rate_percent: cases ? Number(((passed / cases) * 100).toFixed(1)) : 0,
    passed
  };
}

async function resolveCasesPath(workspaceRoot, casesPath) {
  if (casesPath) return path.resolve(workspaceRoot, casesPath);

  for (const candidate of DEFAULT_CASES_PATHS) {
    const absolute = path.join(workspaceRoot, candidate);
    try {
      await fs.access(absolute);
      return absolute;
    } catch {
      // Try the next conventional eval location.
    }
  }

  throw new Error(
    `No eval gold set found. Create ${DEFAULT_CASES_PATHS.join(" or ")} or pass --cases path.`
  );
}

function resolveCaseWorkspaceRoot(workspaceRoot, casesDir, caseWorkspace) {
  if (!caseWorkspace) return workspaceRoot;
  if (path.isAbsolute(caseWorkspace)) return path.resolve(caseWorkspace);
  return path.resolve(casesDir, caseWorkspace);
}

function normalizePathList(paths) {
  return [...new Set((paths ?? []).filter(Boolean).map((item) => String(item).replaceAll("\\", "/")))];
}

function toPercent(value) {
  return Number((Math.max(0, Math.min(1, value)) * 100).toFixed(1));
}

function average(total, count) {
  return count ? Number((total / count).toFixed(1)) : 0;
}
