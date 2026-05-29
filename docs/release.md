# Release Readiness

This project is not published yet. These steps keep the local alpha ready for
an eventual open-source release without requiring a commit, push, marketplace
publish, or GitHub settings change.

## Local Release Check

Run:

```bash
npm run release:check
```

This validates:

- required docs and package files
- GitHub Pages landing page
- GitHub Pages SEO files and blog pages
- packet-quality eval docs and demo gold set
- package metadata
- VS Code extension manifest coverage
- CI workflow coverage
- syntax checks
- Node test suite
- workspace doctor
- demo workspace smoke path

## VS Code Extension Staging

The extension works in this monorepo during development. Marketplace-style
packaging needs the local CLI and engine bundled with the extension.

Create a staged extension folder:

```bash
npm run vscode:stage
```

Output:

```text
dist/vscode-extension/
```

The staged folder includes:

- extension manifest
- extension entrypoint
- extension README and changelog
- resources
- bundled `cli`, `engine`, and `shared` packages under `vendor/`

The extension runtime checks both paths:

- monorepo development path: `../cli/bin/context-delta.js`
- staged package path: `vendor/context-delta-engine/packages/cli/bin/context-delta.js`

## Before First Public Release

Required human-owned actions:

- decide whether to publish npm packages now or keep repo-only usage
- decide whether to publish the VS Code extension
- confirm GitHub Pages is enabled for `main` and `/docs`
- enable private vulnerability reporting if desired
- create the first GitHub release
- commit and push from the maintainer account

## GitHub Pages

GitHub Pages should be configured as:

```text
Source: Deploy from a branch
Branch: main
Folder: /docs
```

The public landing page entry is:

```text
docs/index.html
```

The expected repo Pages URL is:

```text
https://contextdelta.github.io/context-delta-engine/
```

## Suggested First Release Notes

```text
Context Delta 0.1.0 introduces a local-first context packet engine for AI
coding agents and spec-driven development. It includes a CLI, MCP server, VS
Code dashboard, packet insights, compact previews, packet diffs, prompt-ready
handoffs, packet-quality evals, approval/replay artifacts, local reports,
manager summaries, launch-ready GitHub Pages docs, demo visuals, and a demo
workspace.
```
