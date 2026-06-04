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
  fails the eval gate.
- **ContextBench** (`npm run contextbench`): the labeled gold set packaged as a
  citable, reproducible correctness benchmark (impact coverage, omission rate,
  useful-context density, forbidden inclusions — token reduction as a secondary
  signal), with a generated scorecard, a published spec, and a contribution path
  for new cases.
- AGENTS.md, CLAUDE.md, Copilot, Cursor, and generic instruction precedence
  with closest-file-wins ordering.
- Source graph neighbor detection for changed source files.
- Import-graph resolution for Rust (`mod`/`use crate/super/self`), Java
  (package-qualified imports), Ruby (`require_relative`), and PHP (relative
  `require`/`include` and PSR-4 `use`), plus a Rust gold-set case and
  top-level `tests/` directory recognition. The bundled gold set is now eight
  cases across seven languages and a precision shape.
- Content-, symbol-, and IDF-aware relevance ranking (local and deterministic,
  no embeddings): the ranker reads file content and declared symbols (JS/TS,
  Python, Go) and weights rare task terms higher, replacing the hardcoded
  auth-domain keyword regex with relevance derived from the repo itself.
- Signature-skeleton compression (`compression.js`): distant graph neighbors
  (2+ hops from the change) are sent as declaration/signature skeletons with
  bodies stripped — deterministic, model-free — falling back to full content
  when stripping wouldn't help. Direct impact keeps full bodies.
- Packet approval and replay artifacts for reviewable agent handoff.
- Local HTML report and manager summary exports.
- MCP stdio server with packet, compact, insight, diff, handoff, eval,
  approval, replay, summary, report, scan, and metrics tools/resources.
- MCP protocol-version negotiation, `ping`, and clean `resources/templates/list`
  / `prompts/list` connect-time probes; tool runtime errors now return
  `isError` results and protocol errors use `-32601` / `-32700` codes.
- Automated multi-host MCP conformance harness (`npm run mcp:conformance`,
  wired into `release:check`) and a published host conformance contract.
- GitHub Action (`context-packet.yml`) that posts a privacy-safe packet summary
  on each PR — the working set, exclusions, and token economics, never raw code
  — making the agent's context a reviewable artifact. Rendered by
  `npm run pr-comment`.
- Local performance benchmark (`npm run benchmark`): ~80 ms scan / ~570 ms full
  packet assembly on a 1,000-file repo, reproducible and model-free.
- Performance regression guard (`npm run benchmark:assert`) and an in-suite time
  budget, plus robustness coverage (empty workspaces, binary/oversized/
  extensionless files, pathological minified lines, unusual ignore patterns) so
  the engine degrades gracefully and never crashes, hangs, or silently slows.
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

- `.gitignore` / `.deltaignore` inheritance during workspace scan (comments,
  negation, directory and glob patterns).
- Budget auto-escalation by change volume (focused/balanced/thorough tiers) with
  an honest per-section token allocation breakdown in the packet budget.
- Monorepo detection (pnpm, nx, turbo, lerna, npm/yarn workspaces) surfaced in
  packet workspace metadata.
- `prepare` npm lifecycle guard so installing/publishing no longer triggers a
  CLI packet build, while `npm run prepare -- "task"` still works.

- Spec freshness: deprecated/superseded specs are detected and kept out of the
  packet (with a reason, a warning, and a `spec_review` block), plus a
  spec-supersession ContextBench case — so stale requirements are not fed to the
  agent. The gold set is now nine cases.
- Governance `compliance` block on every packet: policy exclusions, secret
  redaction status, deprecated specs excluded, and an optional
  `policy.maxDeliveredTokens` hard ceiling with violation flagging — making the
  packet an audit artifact.
- Packet format contract: a published JSON Schema (`docs/packet.schema.json`)
  plus a dependency-free validator (`validatePacket`, `npm run validate:packet`,
  in `release:check`) that also enforces invariants (delivered ≤ baseline,
  reduction in range), so the packet structure cannot drift unnoticed.

### Security

- Default path exclusions for secrets and local runtime folders.
- Secret-like content redaction before packet output.
- Privacy-safe metrics that avoid raw source and prompt text by default.
