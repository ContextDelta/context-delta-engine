# CLI

The first Context Delta prototype is available through a local Node CLI.

Run commands from the repository root:

```bash
npm run context-delta -- --help
```

For first-run setup guidance:

```bash
npm run setup -- --target cli
```

`setup` can check the path you actually want:

```bash
npm run setup -- --target cli
npm run setup -- --target mcp
npm run setup -- --target vscode
```

Add `--fix` to create the default config and install the staged VS Code
extension when that target needs it. The CLI and MCP paths do not require a
manual packet review loop.

## Prepare Context

For day-to-day agent work, use `prepare`. It builds context, infers a task
when possible, and prints a risk header plus a prompt-ready handoff:

```bash
npm run prepare -- "Add refresh token rotation for admin users"
```

```text
Context ready · risk=low · budget=low · warnings=0 · tests=2 · specs=1
```

Use `packet` when you want the raw packet artifact and local audit trail:

```bash
npm run packet -- "Add refresh token rotation for admin users"
```

The command scans the workspace, detects git changes when available, falls
back to local snapshots when git is not available, parses markdown specs and
instructions, builds a context packet, and writes output to:

```text
.contextdelta/packets/latest.json
.contextdelta/reports/session-metrics.jsonl
```

Use JSON output:

```bash
npm run packet -- "Fix auth tests" --json
```

Include the compact preview in JSON output:

```bash
npm run packet -- "Fix auth tests" --json --compact
```

Dry run without writing files:

```bash
npm run packet -- "Fix auth tests" --dry-run
```

Generate a local HTML report while writing the packet:

```bash
npm run packet -- "Fix auth tests" --report
```

Use packet controls:

```bash
npm run packet -- "Fix auth tests" --mode conservative --pin docs/auth.md --exclude docs/legacy/
```

## Scan Workspace

```bash
npm run context-delta -- scan
```

Shows file classification counts:

- source
- tests
- specs
- docs
- instructions
- config

## Write Snapshot

```bash
npm run snapshot
```

Creates a local baseline under `.contextdelta/index/snapshot.json`.

This makes Context Delta useful even in folders that are not git
repositories.

## Metrics

```bash
npm run context-delta -- metrics
```

Shows local privacy-safe metrics:

- sessions
- estimated tokens saved
- average context reduction
- average useful-context density
- average packet size
- packet expansions
- stale spec warnings
- risk mix
- budget pressure mix
- redactions applied

## Report

```bash
npm run report
```

Generates `.contextdelta/reports/latest.html` from the latest packet.

## Insights

```bash
npm run context-delta -- insights
```

Reads the latest packet and shows:

- packet headline
- risk level
- spec/test/budget/savings signals
- recommendations

JSON output:

```bash
npm run context-delta -- insights --json
```

## Compact Preview

```bash
npm run context-delta -- compact
```

Reads the latest packet and prints a content-free preview with paths,
reasons, warnings, metrics, budget pressure, and recommendations.

JSON output:

```bash
npm run context-delta -- compact --json
```

## Controls Cleanup

```bash
npm run controls -- --cleanup-stale
```

Removes manual pinned or excluded paths from `contextdelta.config.json` when
the file or folder no longer exists. This is useful after renames, deleted
docs, or experiments with packet controls.

## Packet History

```bash
npm run history
```

Shows recent packet IDs, tasks, risk level, included file count, and estimated
tokens saved.

JSON output:

```bash
npm run history -- --json
```

## Packet Diff

```bash
npm run diff
```

Compares the latest packet with the previous packet and shows:

- added context
- removed context
- warning changes
- risk change
- budget change
- token estimate deltas

JSON output:

```bash
npm run diff -- --json
```

Specific packets:

```bash
npm run diff -- --from packet-old --to packet-new
```

## Drift Review

```bash
npm run drift
```

Compares the latest packet with current git changes after an agent run. It
answers the adoption-critical question:

```text
Did the agent change files that were not in the context packet?
```

JSON output:

```bash
npm run drift -- --json
```

## Agent Handoff

```bash
npm run handoff -- --format copilot
```

Supported formats:

- `markdown`
- `copilot`
- `spec-kit`
- `replay`
- `compact`
- `json`

Write to a file:

```bash
npm run handoff -- --format spec-kit --output .contextdelta/reports/spec-kit-handoff.md
```

## Packet Eval

```bash
npm run eval -- --workspace examples/demo-workspace --cases ../eval/gold-set.json
```

Run the release-gated multi-shape suite:

```bash
npm run eval:multi
```

Scores generated packets against a labeled gold set and writes:

```text
.contextdelta/eval/latest-eval.json
.contextdelta/eval/latest-eval.md
```

The key quality metrics are useful-context density, impact coverage, omission
rate, forbidden inclusions, and packet size. Add `--fail-on-failure` when an
eval should behave like a CI gate.

## Approval And Replay

```bash
npm run approve -- --decision approved
npm run replay
```

`approve` records a local packet review decision under
`.contextdelta/approvals/`. `replay` prints a review prompt for checking an AI
coding result against the exact compact packet that was available.

## Manager Summary

```bash
npm run summary
```

Writes:

```text
.contextdelta/reports/weekly-summary.md
.contextdelta/reports/weekly-summary.json
```

## Config

```bash
npm run init
```

Creates `contextdelta.config.json` with policy, redaction, pinning, and
exclusion defaults.

## Doctor

```bash
npm run doctor
```

Checks basic workspace readiness.

For first-run setup status:

```bash
npm run setup -- --target cli
```

For local setup fixes:

```bash
npm run setup -- --fix --target vscode
```

For MCP setup snippets:

```bash
npm run doctor -- --mcp
```

## Notes

The CLI currently has no external runtime dependencies. It uses Node.js and
the local packages in this repository.
