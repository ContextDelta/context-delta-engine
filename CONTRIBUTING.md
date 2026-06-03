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
