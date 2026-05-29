# Launch Checklist

This is the working checklist for moving Context Delta from prototype to a
launchable open-source alpha.

## Product

- [x] Clear public README
- [x] Spec-driven development positioning
- [x] Spec Kit complement story
- [x] GitHub Copilot workflow story
- [x] CLI prototype
- [x] Local packet JSON
- [x] Packet insights and compact preview
- [x] Packet history and diff
- [x] Copilot, Spec Kit, Markdown, replay, compact, and JSON handoff formats
- [x] Packet-quality eval harness and demo gold set
- [x] Packet approval and replay artifacts
- [x] AGENTS.md / CLAUDE.md / Copilot instruction precedence
- [x] Source graph neighbor detection
- [x] Metrics JSONL
- [x] HTML report with insight section
- [x] Manager summary export
- [x] MCP server with packet, insights, compact preview, diff, handoff, eval, approval, replay, summary, report, scan, and metrics
- [x] VS Code extension shell with activity bar dashboard and item actions
- [x] GitHub Pages landing page
- [x] Demo preview visuals for README and Pages
- [x] Blog index and launch starter posts
- [x] SEO basics: canonical links, robots.txt, sitemap.xml, and structured data
- [x] Release validation script
- [x] Demo smoke script
- [x] VS Code extension staging script
- [ ] Packaged VS Code extension
- [ ] Tested with real Claude Code/Cursor MCP clients
- [x] Synthetic demo visuals
- [ ] Screenshots from real extension
- [ ] Public demo GIF or short video

## Safety

- [x] Local-first defaults
- [x] Policy exclusions
- [x] Secret redaction
- [x] Dry-run mode
- [x] No-git snapshot fallback
- [x] Privacy wording distinguishes local packet assembly from explicit agent handoff
- [ ] Redaction test corpus
- [ ] Signed release artifacts
- [ ] Security reporting enabled on GitHub

## Engineering

- [x] Node test suite
- [x] CLI smoke tests
- [x] MCP smoke test
- [x] Syntax checks
- [x] CI workflow
- [x] Release-check workflow
- [x] Deleted-file, binary-file, large-file, instruction precedence, graph-neighbor, packet-history, eval, approval/replay, and handoff tests
- [ ] Coverage thresholds
- [ ] Extension host integration test
- [ ] Cross-platform path tests

## Documentation

- [x] README
- [x] CLI docs
- [x] Configuration docs
- [x] Observability docs
- [x] MCP docs
- [x] Metrics docs
- [x] Packet-quality eval docs
- [x] Edge cases
- [x] Demo examples
- [x] GitHub Pages landing page
- [x] Static HTML Pages docs for CLI, VS Code, MCP, Spec Kit, metrics, and release readiness
- [x] Static blog pages and sitemap
- [ ] Screenshots from real extension
- [ ] Published GitHub Pages site

## Before Public Announcement

- [ ] Run on three real repositories
- [ ] Validate MCP flow in at least two agent clients
- [ ] Record before/after packet demo
- [ ] Create first GitHub release
- [ ] Add issue labels
- [x] Add CI badge after CI exists
