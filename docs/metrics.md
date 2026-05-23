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
Manual overrides
Packet expansions
Missing-context corrections
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
  "tokens_saved_estimate": 13800,
  "context_reduction_percent": 65.7,
  "included_files_count": 8,
  "excluded_files_count": 23,
  "included_spec_units_count": 3,
  "included_tests_count": 2,
  "manual_overrides_count": 1,
  "packet_expansions_count": 0,
  "stale_spec_warnings_count": 1
}
```

## Org-Level Metrics

Later, teams can aggregate repo-level metrics into a dashboard:

```text
This month:
- 42M estimated input tokens saved
- 61% average context reduction
- 84% packets accepted without edits
- 19 stale spec warnings
- 31 repeated-context lookups avoided
```

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

## Future Reports

Possible report types:

- weekly repo summary
- stale spec report
- high-noise directories
- agent host comparison
- context override report
- context savings by task type

