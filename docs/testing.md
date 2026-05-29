# Testing

Run the full local check:

```bash
npm run check
```

Run the release-readiness check:

```bash
npm run release:check
```

This runs:

- Node test suite
- syntax checks
- workspace doctor check
- release metadata validation
- demo workspace smoke test

GitHub Actions also runs these checks on pushes and pull requests to `main`.

Run syntax checks for entrypoints:

```bash
npm run syntax
```

## Current Test Coverage

The current suite covers:

- file classification
- no-git packet generation
- git deleted-file detection
- binary and oversized file handling
- snapshot delta detection
- pin and exclude controls
- secret redaction
- HTML report generation
- CLI JSON output
- CLI insights and compact preview output
- CLI handoff, history, diff, and manager summary output
- CLI config initialization
- packet history and packet diff generation
- handoff rendering
- manager summary report writing
- MCP tool listing
- MCP resource reads
- config overwrite safety

## Demo Workspace

Use the demo workspace for a quick manual smoke test:

```bash
npm run packet -- "Add admin refresh token rotation" --workspace examples/demo-workspace --dry-run
```

Generate a report:

```bash
npm run packet -- "Add admin refresh token rotation" --workspace examples/demo-workspace --report
```
