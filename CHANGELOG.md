# Changelog

All notable changes to Context Delta will be documented here.

The format follows Keep a Changelog style, and this project uses semantic
versioning once releases begin.

## 0.1.0 - Unreleased

### Added

- Local workspace scanner and file classification.
- Git delta detection with local snapshot fallback for no-git workspaces.
- Markdown spec, task, documentation, and instruction section extraction.
- Context packet builder with changed artifacts, supporting evidence,
  governing constraints, impacted neighbors, exclusions, warnings, metrics,
  redaction metadata, insights, and compact preview.
- CLI commands for packet, scan, snapshot, metrics, report, insights, compact,
  history, diff, handoff, summary, eval, approve, replay, init, and doctor.
- Prompt-ready handoff formats for Markdown, GitHub Copilot, Spec Kit,
  replay, compact JSON, and full JSON.
- Packet-quality eval harness with demo gold set, useful-context density,
  impact coverage, omission-rate, and forbidden-inclusion scoring.
- Go service/test gold-set case (module-aware billing validation) proving
  Go import resolution and coverage edges end to end in the eval gate.
- Precision gold-set case (inventory service with unrelated decoy modules,
  gated on useful-context density) so a ranking regression that pulls in noise
  fails the eval gate. The bundled set is now seven cases.
- AGENTS.md, CLAUDE.md, Copilot, Cursor, and generic instruction precedence
  with closest-file-wins ordering.
- Source graph neighbor detection for changed source files.
- Content-, symbol-, and IDF-aware relevance ranking (local and deterministic,
  no embeddings): the ranker reads file content and declared symbols (JS/TS,
  Python, Go) and weights rare task terms higher, replacing the hardcoded
  auth-domain keyword regex with relevance derived from the repo itself.
- Packet approval and replay artifacts for reviewable agent handoff.
- Local HTML report and manager summary exports.
- MCP stdio server with packet, compact, insight, diff, handoff, eval,
  approval, replay, summary, report, scan, and metrics tools/resources.
- MCP protocol-version negotiation, `ping`, and clean `resources/templates/list`
  / `prompts/list` connect-time probes; tool runtime errors now return
  `isError` results and protocol errors use `-32601` / `-32700` codes.
- Automated multi-host MCP conformance harness (`npm run mcp:conformance`,
  wired into `release:check`) and a published host conformance contract.
- VS Code extension shell with activity bar dashboard, packet view, insight
  view, diff view, manager summary view, handoff copy, and packet item actions.
- GitHub Pages landing page, supporting static docs, and launch preview
  visuals under `docs/`.
- Professional GitHub Pages visual system pass with sharper typography,
  section bands, trust badges, focused CTAs, and a packet-quality metrics
  dashboard.
- Blog index, starter article pages, robots.txt, sitemap.xml, canonical links,
  scroll progress, and a shared scroll-to-top control for GitHub Pages.
- Demo workspace and launch/demo documentation.
- CI workflow, issue templates, PR template, and local release validation
  scripts.

### Fixed

- Manual-override metric is now real: `manual_overrides_count` is derived from
  the packet's pin/exclude controls instead of a hardcoded `0`, surfaced in the
  metrics summary, CLI, manager report, and VS Code dashboard. The always-zero
  "packet expansions" display (an unimplemented feature) was replaced by the
  override count in the CLI and dashboard.

### Security

- Default path exclusions for secrets and local runtime folders.
- Secret-like content redaction before packet output.
- Privacy-safe metrics that avoid raw source and prompt text by default.
