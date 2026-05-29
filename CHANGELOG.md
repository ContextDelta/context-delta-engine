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
- AGENTS.md, CLAUDE.md, Copilot, Cursor, and generic instruction precedence
  with closest-file-wins ordering.
- Source graph neighbor detection for changed source files.
- Packet approval and replay artifacts for reviewable agent handoff.
- Local HTML report and manager summary exports.
- MCP stdio server with packet, compact, insight, diff, handoff, eval,
  approval, replay, summary, report, scan, and metrics tools/resources.
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

### Security

- Default path exclusions for secrets and local runtime folders.
- Secret-like content redaction before packet output.
- Privacy-safe metrics that avoid raw source and prompt text by default.
