# Contributing

Context Delta is early. Contributions are welcome, especially around:

- **ContextBench gold-set cases** — the highest-leverage contribution. See
  [docs/contextbench.md](docs/contextbench.md) for how to add a labeled task.
- clear examples
- spec-driven development workflows
- GitHub Copilot workflows
- MCP integration design
- metrics schemas
- edge cases from real repositories
- prototype implementation

## Project Principles

- Keep the user workflow simple.
- Prefer local-first defaults.
- Make context visible and explainable.
- Avoid collecting raw code or prompt text in metrics by default.
- Design for graceful degradation.
- Keep integrations portable.

## Before Opening A Pull Request

- Keep changes focused.
- Update docs when behavior or positioning changes.
- Avoid adding heavy dependencies without a clear reason.
- Do not include secrets, private code, or customer data.
- Make examples understandable without deep architecture knowledge.

## Local Validation

Run the standard check:

```bash
npm run check
```

Run the fuller alpha release check:

```bash
npm run release:check
```

This validates package metadata, docs, extension manifest coverage, syntax,
tests, workspace doctor, and demo smoke behavior.

### Quality gates (what stops a regression reaching users)

`release:check` runs all of these, so a regression in any of them fails the build:

- `npm test` — unit + integration suite.
- `npm run eval:multi` / `npm run contextbench` — packet **correctness** (impact
  coverage, omission, density, forbidden) against the labeled gold set.
- `npm run e2e` — the full pipeline over the live MCP server.
- `npm run mcp:conformance` — the MCP wire contract real hosts depend on.
- `npm run validate:packet` — the packet **format contract**.

Two more guards run on demand:

- `npm run benchmark:assert` — **performance** regression guard (fails on a
  catastrophic slowdown).
- `npm run benchmark` — detailed local timings.

If you change ranking, compression, or packet assembly, run `contextbench` and
`benchmark:assert` before opening a PR — those are the behaviors users notice.

## VS Code Extension Development

Use the launch configuration:

```text
Run Context Delta Extension
```

For staging a marketplace-style extension folder:

```bash
npm run vscode:stage
```

The staged output is written to `dist/vscode-extension/`.

## Development Status

The project is currently an alpha-quality local prototype. Core CLI, engine,
MCP, VS Code, metrics, handoff, and report surfaces exist, but real-world
agent validation and release packaging still need maintainer review.
