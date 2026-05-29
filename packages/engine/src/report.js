import fs from "node:fs/promises";
import path from "node:path";
import { buildPacketInsights } from "./insights.js";
import { readMetricsSummary } from "./metrics.js";
import { writeEvent } from "./observability.js";
import { getUniqueIncludedItems } from "./packet.js";

export async function writeHtmlReport(workspaceRoot, packet) {
  const reportsDir = path.join(workspaceRoot, ".contextdelta", "reports");
  const reportPath = path.join(reportsDir, "latest.html");
  const metrics = await readMetricsSummary(workspaceRoot);
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(reportPath, renderHtmlReport(packet, metrics));
  await writeEvent(workspaceRoot, "report_written", {
    packet_id: packet.id,
    report_path: reportPath
  });
  return reportPath;
}

export function renderHtmlReport(packet, metrics = {}) {
  const included = getUniqueIncludedItems(packet);
  const insights = packet.insights ?? buildPacketInsights(packet);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Context Delta Report</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f8fafc;
      --fg: #18202f;
      --muted: #5f6c7d;
      --panel: #ffffff;
      --line: #d8dee9;
      --accent: #0f766e;
      --warn: #a16207;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #10141c;
        --fg: #eef2f8;
        --muted: #aab4c2;
        --panel: #171d28;
        --line: #303846;
        --accent: #2dd4bf;
        --warn: #facc15;
      }
    }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
      margin: 0;
    }
    main {
      margin: 0 auto;
      max-width: 1160px;
      padding: 40px 24px;
    }
    header {
      border-bottom: 1px solid var(--line);
      margin-bottom: 24px;
      padding-bottom: 20px;
    }
    h1 {
      font-size: 2rem;
      margin: 0 0 8px;
    }
    h2 {
      margin-top: 32px;
    }
    .muted {
      color: var(--muted);
    }
    .grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }
    .card, .item {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }
    .card strong {
      display: block;
      font-size: 1.6rem;
      margin-top: 4px;
    }
    .item {
      margin-bottom: 10px;
    }
    code {
      color: var(--accent);
      overflow-wrap: anywhere;
    }
    .reason {
      color: var(--muted);
      margin-top: 4px;
    }
    .warning {
      border-color: var(--warn);
    }
    .insight {
      display: grid;
      gap: 12px;
      grid-template-columns: 1.3fr 0.7fr;
      margin: 24px 0;
    }
    .recommendations {
      margin: 0;
      padding-left: 20px;
    }
    .signal {
      border-top: 1px solid var(--line);
      padding: 10px 0;
    }
    .signal:first-child {
      border-top: 0;
      padding-top: 0;
    }
    .signal strong {
      display: block;
    }
    @media (max-width: 720px) {
      .insight {
        grid-template-columns: 1fr;
      }
    }
    pre {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: auto;
      padding: 16px;
    }
  </style>
</head>
<body>
<main>
  <header>
    <h1>Context Delta Report</h1>
    <div class="muted">${escapeHtml(packet.intent.task)}</div>
  </header>

  <section class="insight">
    <div class="card">
      <span class="muted">Packet Insight</span>
      <strong>${escapeHtml(insights.headline)}</strong>
      <p class="muted">Risk: ${escapeHtml(insights.risk_level)}</p>
      ${(insights.cards ?? []).map(renderInsightCard).join("")}
    </div>
    <div class="card">
      <span class="muted">Recommended Next Steps</span>
      <ul class="recommendations">
        ${(insights.recommendations ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>
  </section>

  <section class="grid">
    ${metric("Changed", packet.summary.changed_files_count)}
    ${metric("Included", packet.summary.included_files_count)}
    ${metric("Specs", packet.summary.included_spec_units_count)}
    ${metric("Tests", packet.summary.included_tests_count)}
    ${metric("Excluded", packet.summary.excluded_files_count)}
    ${metric("Saved", `${packet.metrics.tokens_saved_estimate} tokens`)}
    ${metric("Reduction", `${packet.metrics.context_reduction_percent}%`)}
    ${metric("Useful Density", `${packet.metrics.heuristic_useful_context_density_percent ?? 0}%`)}
    ${metric("Budget", packet.budget?.pressure ?? "unknown")}
    ${metric("Redactions", packet.security?.redactions_applied ?? 0)}
  </section>

  <h2>Warnings</h2>
  ${packet.warnings.length ? packet.warnings.map(renderWarning).join("") : "<p class=\"muted\">No warnings.</p>"}

  <h2>Included Context</h2>
  ${included.map(renderItem).join("")}

  <h2>Excluded Context</h2>
  ${packet.excluded.map(renderItem).join("")}

  <h2>Metrics Summary</h2>
  <p class="muted">Token reduction is a workspace-text upper bound. Use packet-quality eval results for correctness claims.</p>
  <pre>${escapeHtml(JSON.stringify(metrics, null, 2))}</pre>
</main>
</body>
</html>`;
}

function metric(label, value) {
  return `<div class="card"><span class="muted">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderItem(item) {
  return `<div class="item">
    <code>${escapeHtml(item.path ?? "unknown")}${item.heading ? `#${escapeHtml(item.heading)}` : ""}</code>
    <div class="reason">${escapeHtml(item.reason ?? "")}</div>
  </div>`;
}

function renderWarning(warning) {
  return `<div class="item warning">
    <code>${escapeHtml(warning.type)}</code>
    <div class="reason">${escapeHtml(warning.message)}</div>
  </div>`;
}

function renderInsightCard(card) {
  return `<div class="signal">
    <strong>${escapeHtml(card.title)}</strong>
    <div class="muted">${escapeHtml(card.body)}</div>
  </div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
