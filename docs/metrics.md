# Metrics

Context Delta should make context quality measurable without collecting raw
source code or prompt text by default.

Metrics serve two audiences:

- developers who want to know whether context is helping
- engineering leaders who want to understand adoption, savings, and friction

## User-Level Metrics

For an individual session:

```text
Estimated input tokens saved
Packet size
Baseline context estimate
Included file count
Excluded file count
Included spec units
Included tests
Packet risk level
Budget pressure
Redactions applied
Manual overrides
Useful-context density (per-packet heuristic)
Eval impact coverage
```

Example:

```text
This session:
- 9,200 estimated tokens saved
- 58% smaller context packet
- 2 related tests included
- 14 noisy files excluded
- 1 manual override
```

## Repo-Level Metrics

The local engine can emit privacy-safe JSONL records:

```text
.contextdelta/reports/session-metrics.jsonl
.contextdelta/reports/weekly-summary.md
.contextdelta/reports/weekly-summary.json
```

Example event:

```json
{
  "schema_version": "0.1",
  "timestamp": "2026-05-23T12:00:00Z",
  "repo_id_hash": "repo_abc123",
  "session_id_hash": "session_def456",
  "agent_host": "vscode-copilot",
  "packet_tokens_estimate": 7200,
  "baseline_tokens_estimate": 21000,
  "baseline_strategy": "workspace_text_upper_bound",
  "tokens_saved_estimate": 13800,
  "context_reduction_percent": 65.7,
  "useful_context_density_percent": 58.3,
  "included_files_count": 8,
  "excluded_files_count": 23,
  "included_spec_units_count": 3,
  "included_tests_count": 2,
  "risk_level": "low",
  "budget_pressure": "medium",
  "target_tokens": 12000,
  "warnings_count": 1,
  "redactions_applied_count": 0,
  "manual_overrides_count": 1,
  "stale_spec_warnings_count": 1
}
```

## Org-Level Metrics

Later, teams can aggregate repo-level metrics into a dashboard. The block
below shows the report *format* with placeholder fields, not measured results
from any deployment — Context Delta does not ship invented totals:

```text
This month (illustrative format, not real data):
- estimated input tokens saved
- average context reduction, labeled as a workspace upper-bound estimate
- useful-context density
- packets accepted without edits
- low-risk packets
- over-budget packets
- stale spec warnings
- repeated-context lookups avoided
```

The only numbers Context Delta claims today come from the reproducible
packet-quality eval (`npm run eval:multi`): 8/8 gold-set cases passing, 96%
average useful-context density, 100% impact coverage, and 82% average
whole-workspace context reduction.

Generate the local repo summary:

```bash
npm run summary
```

The generated Markdown summary is designed to be pasted into a weekly
engineering update without exposing raw code or raw prompts.

## Honest accounting

The numbers are built to survive scrutiny:

- **Exact, per-model token counts.** Delivered context is measured with a real
  tokenizer (configurable via `targetModel`), not a character heuristic.
- **A baseline spectrum, not one number.** Every packet reports reduction
  against three transparent baselines — `open_files_only` (floor),
  `naive_agent` (typical, the headline), and `whole_repo` (ceiling) — so the
  savings claim can't be cherry-picked.
- **Token-weighted rollups.** The aggregate reduction weights by tokens and
  uses delivered (not full-packet) size, so a few no-change runs can't drag it
  to a misleading figure.
- **Windowing.** `npm run metrics -- --since <date>` or `--limit <n>` (and the
  `since` / `limit` arguments on the `get_context_metrics` MCP tool) scope the
  rollup to recent activity.
- **Per-model / per-agent breakdown.** The rollup includes `by_target_model`
  and `by_agent_host`, so savings can be attributed to the model or agent that
  produced them.
- **Two density measures, clearly named.** The rollup's
  `useful_context_density_percent` is a fast per-packet *heuristic* (the share
  of included items that look structurally useful). The headline density in the
  README and `npm run eval:multi` is the *labeled* score against gold-set
  expected/acceptable paths. They answer different questions and can differ; the
  eval number is the quality signal, the heuristic is the always-on proxy.

## Metrics Principles

### Privacy By Default

Do not collect:

- raw source code
- raw prompts
- raw packet text
- secret values
- full file paths if a hash is enough

### Explainable Estimates

Token savings are estimates. The UI should say "estimated" unless exact
tokenization is available for the target model.

### Useful, Not Vanity

The most important metric is not only tokens saved. It is useful-context
density:

```text
How much of the packet actually helped the task succeed?
```

Approximate signals:

- packet accepted without edits
- agent did not repeatedly ask for missing files
- related tests were included
- fewer repeated searches
- fewer manual context corrections

When a gold set exists, use `npm run eval` to replace the heuristic density
with labeled packet-quality scores: impact coverage, omission rate, forbidden
inclusions, and useful-context density.

## Future Reports

Possible report types:

- weekly repo summary
- stale spec report
- high-noise directories
- agent host comparison
- context override report
- context savings by task type
