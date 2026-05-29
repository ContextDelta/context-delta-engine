# Insights And Previews

Context Delta now produces two review-friendly surfaces on top of the full
packet.

## Packet Insights

`packet.insights` turns raw packet structure into a short quality read:

- headline
- risk level
- spec coverage signal
- test coverage signal
- budget signal
- context savings signal
- secret-redaction signal
- recommended next steps
- top selected paths

This is for developers, reviewers, and managers who want to know whether the
packet is ready before an AI agent receives it.

Use it from the CLI:

```bash
npm run context-delta -- insights --workspace .
```

Use JSON output:

```bash
npm run context-delta -- insights --workspace . --json
```

## Compact Packet View

`packet.compact_view` is a content-free preview. It keeps path names,
reasons, counts, warnings, budget pressure, metrics, and recommendations, but
does not include file snippets or diffs.

This is useful for:

- quickly reviewing what would be sent
- copying a lightweight handoff into GitHub Copilot Chat
- dashboards that should not show source code
- org metrics workflows that only need metadata

Use it from the CLI:

```bash
npm run context-delta -- compact --workspace .
```

Use JSON output:

```bash
npm run context-delta -- compact --workspace . --json
```

## Where It Appears

Insights and compact previews are surfaced in:

- CLI packet summaries
- `context-delta insights`
- `context-delta compact`
- local HTML reports
- VS Code dashboard
- VS Code packet and insight webviews
- MCP tools
- MCP resources

## Packet History And Diff

Every written packet is stored as a timestamped JSON file. The latest packet
is also written to:

```text
.contextdelta/packets/latest.json
```

When a previous packet exists, Context Delta writes:

```text
.contextdelta/packets/latest-diff.json
```

Use the CLI:

```bash
npm run history
npm run diff
```

The diff shows added context, removed context, warning changes, risk changes,
budget changes, and token estimate deltas.

## Agent Handoff Formats

Use:

```bash
npm run handoff -- --format copilot
```

Supported formats:

- `markdown`
- `copilot`
- `spec-kit`
- `compact`
- `json`

## MCP Surfaces

Tools:

- `get_context_insights`
- `get_compact_context_packet`
- `diff_context_packets`
- `render_context_handoff`

Resources:

- `contextdelta://packet/insights`
- `contextdelta://packet/compact`
- `contextdelta://packet/diff`
- `contextdelta://handoff/markdown`
