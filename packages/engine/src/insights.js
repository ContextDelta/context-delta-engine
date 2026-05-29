export function buildPacketInsights(packet) {
  const included = getUniqueItems([
    ...packet.changed_artifacts,
    ...packet.supporting_evidence,
    ...packet.governing_constraints,
    ...packet.impacted_neighbors
  ]);
  const warnings = packet.warnings ?? [];
  const redactions = packet.security?.redactions_applied ?? 0;
  const budgetPressure = packet.budget?.pressure ?? "unknown";
  const changedCount = packet.summary?.changed_files_count ?? packet.changed_artifacts.length;
  const specCount = packet.summary?.included_spec_units_count ?? 0;
  const testCount = packet.summary?.included_tests_count ?? 0;
  const reduction = packet.metrics?.context_reduction_percent ?? 0;
  const tokensSaved = packet.metrics?.tokens_saved_estimate ?? 0;
  const usefulDensity = packet.metrics?.heuristic_useful_context_density_percent ?? 0;
  const riskLevel = getRiskLevel({ budgetPressure, specCount, testCount, warnings });

  const cards = [
    {
      body:
        changedCount > 0
          ? `${changedCount} changed file${changedCount === 1 ? "" : "s"} anchor the packet.`
          : "No changed files were detected, so relevance comes from task text and repository signals.",
      severity: changedCount > 0 ? "good" : "watch",
      title: "Delta Anchor",
      type: "delta"
    },
    {
      body:
        specCount > 0
          ? `${specCount} spec section${specCount === 1 ? "" : "s"} matched the task.`
          : "No matching spec section was included.",
      severity: specCount > 0 ? "good" : "watch",
      title: "Spec Coverage",
      type: "spec"
    },
    {
      body:
        testCount > 0
          ? `${testCount} related test file${testCount === 1 ? "" : "s"} included for behavior checks.`
          : "No related tests were included in the initial packet.",
      severity: testCount > 0 ? "good" : "watch",
      title: "Test Coverage",
      type: "test"
    },
    {
      body: `${formatPercent(reduction)} estimated context reduction and ${tokensSaved} tokens saved.`,
      severity: reduction >= 50 ? "good" : "watch",
      title: "Context Savings",
      type: "savings"
    },
    {
      body: `${formatPercent(usefulDensity)} heuristic useful-context density. Use the eval command for labeled quality scores.`,
      severity: usefulDensity >= 45 ? "good" : "watch",
      title: "Useful Context",
      type: "density"
    },
    {
      body: `Budget pressure is ${budgetPressure}.`,
      severity: ["low", "medium"].includes(budgetPressure) ? "good" : "watch",
      title: "Budget Fit",
      type: "budget"
    }
  ];

  if (redactions > 0) {
    cards.push({
      body: `${redactions} secret-like value${redactions === 1 ? "" : "s"} redacted before packet output.`,
      severity: "good",
      title: "Secret Hygiene",
      type: "redaction"
    });
  }

  const recommendations = buildRecommendations({
    budgetPressure,
    included,
    redactions,
    specCount,
    testCount,
    warnings
  });

  return {
    cards,
    headline: buildHeadline({ budgetPressure, riskLevel, specCount, testCount, warnings }),
    recommendations,
    risk_level: riskLevel,
    top_paths: included.slice(0, 6).map((item) => ({
      heading: item.heading,
      path: item.path,
      reason: item.reason,
      type: item.type ?? item.kind ?? "context"
    }))
  };
}

export function buildCompactPacketView(packet) {
  const included = getUniqueItems([
    ...packet.changed_artifacts,
    ...packet.supporting_evidence,
    ...packet.governing_constraints,
    ...packet.impacted_neighbors
  ]);

  return {
    budget: {
      packet_tokens_estimate: packet.budget?.packet_tokens_estimate,
      pressure: packet.budget?.pressure,
      target_tokens: packet.budget?.target_tokens
    },
    created_at: packet.created_at,
    excluded: (packet.excluded ?? []).slice(0, 20).map(compactItem),
    id: packet.id,
    included: included.map(compactItem),
    insights: packet.insights
      ? {
          headline: packet.insights.headline,
          recommendations: packet.insights.recommendations,
          risk_level: packet.insights.risk_level
        }
      : undefined,
    intent: packet.intent,
    metrics: {
      context_reduction_percent: packet.metrics?.context_reduction_percent,
      heuristic_useful_context_density_percent:
        packet.metrics?.heuristic_useful_context_density_percent,
      packet_tokens_estimate: packet.metrics?.packet_tokens_estimate,
      tokens_saved_estimate: packet.metrics?.tokens_saved_estimate
    },
    summary: packet.summary,
    warnings: packet.warnings
  };
}

function buildHeadline({ budgetPressure, riskLevel, specCount, testCount, warnings }) {
  if (riskLevel === "high") {
    return "Packet needs review before handing it to an AI agent.";
  }

  if (warnings.length > 0 || budgetPressure === "high") {
    return "Packet is usable, with a few watch items.";
  }

  if (specCount > 0 && testCount > 0) {
    return "Packet is ready for spec-driven AI coding.";
  }

  return "Packet is ready, but adding specs or tests would improve confidence.";
}

function buildRecommendations({ budgetPressure, included, redactions, specCount, testCount, warnings }) {
  const recommendations = [];

  if (specCount === 0) {
    recommendations.push("Add or pin the relevant spec so the AI agent sees the intended behavior.");
  }

  if (testCount === 0) {
    recommendations.push("Pin a nearby test or ask Context Delta to include behavior checks.");
  }

  if (["high", "over"].includes(budgetPressure)) {
    recommendations.push("Use strict mode, lower snippet size, or exclude noisy paths before sending.");
  }

  if (warnings.some((warning) => warning.type === "no-git")) {
    recommendations.push("Run a snapshot after the first pass so no-git workspaces get cleaner deltas.");
  }

  if (redactions > 0) {
    recommendations.push("Review redacted files to confirm secrets are not being pasted into chat.");
  }

  if (included.length === 0) {
    recommendations.push("Refine the task description or pin files because no context was selected.");
  }

  if (recommendations.length === 0) {
    recommendations.push("Send the compact packet first, then expand only if the agent asks for more.");
  }

  return recommendations.slice(0, 5);
}

function compactItem(item) {
  return {
    heading: item.heading,
    kind: item.kind,
    line_start: item.line_start,
    path: item.path,
    reason: item.reason,
    tokens_estimate: item.tokens_estimate,
    type: item.type ?? item.kind ?? "context"
  };
}

function getRiskLevel({ budgetPressure, specCount, testCount, warnings }) {
  const warningTypes = new Set(warnings.map((warning) => warning.type));
  if (budgetPressure === "over" || warningTypes.has("budget-over-target")) return "high";
  if (warningTypes.has("stale-spec") || specCount === 0) return "medium";
  if (testCount === 0 || warningTypes.has("first-run-snapshot")) return "medium";
  if (warnings.length > 0 || budgetPressure === "high") return "medium";
  return "low";
}

function getUniqueItems(items) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const key = [
      item.type ?? item.kind ?? "item",
      item.path ?? "unknown",
      item.heading ?? item.line_start ?? ""
    ].join(":");

    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function formatPercent(value) {
  return `${Number(value ?? 0).toFixed(1).replace(/\.0$/, "")}%`;
}
