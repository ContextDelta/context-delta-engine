# Demo Script

This is a short demo path for showing Context Delta without a separate repo.

For the public story, use the preview visuals in `docs/site/assets/`:

- `context-savings-preview.svg`
- `vscode-dashboard-preview.svg`
- `metrics-rollup-preview.svg`

## 1. Doctor

```bash
npm run doctor
```

Expected:

```text
Status: ready
```

## 2. Demo Packet

```bash
npm run packet -- "Add admin refresh token rotation" --workspace examples/demo-workspace --dry-run
```

What to point out:

- spec sections are included
- test file is included
- Copilot instruction is pinned
- packet insight explains whether it is ready
- reasons are visible
- no external service is required

## 3. JSON Packet

```bash
npm run packet -- "Add admin refresh token rotation" --workspace examples/demo-workspace --json --dry-run
```

What to point out:

- exact packet is visible
- packet has budget metadata
- packet has security metadata
- included/excluded reasons are machine-readable

## 4. HTML Report

```bash
npm run packet -- "Add admin refresh token rotation" --workspace examples/demo-workspace --report
```

Open:

```text
examples/demo-workspace/.contextdelta/reports/latest.html
```

What to point out:

- manager-friendly summary
- packet inspection
- warnings
- redaction count
- included/excluded context

## 5. Compact Preview

```bash
npm run context-delta -- compact --workspace examples/demo-workspace
```

What to point out:

- metadata-only preview
- no source snippets
- useful for quick review before handoff

## 6. Agent Handoff

```bash
npm run handoff -- --workspace examples/demo-workspace --format copilot
```

What to point out:

- Copilot-ready prompt context
- explicit task, risk, budget, specs, tests, and repo instructions
- no hidden prompt assembly

## 7. Packet Diff

Run a second packet, then:

```bash
npm run diff -- --workspace examples/demo-workspace
```

What to point out:

- added and removed context
- risk and budget changes
- warning changes

## 8. Manager Summary

```bash
npm run summary -- --workspace examples/demo-workspace
```

What to point out:

- local weekly summary files
- risk mix
- budget mix
- redactions and stale spec warnings

## 9. MCP Smoke Test

Use the MCP server to call `get_context_packet`.

What to point out:

- the same local engine can serve multiple hosts
- packets are portable
- the agent does not need hidden prompt access
