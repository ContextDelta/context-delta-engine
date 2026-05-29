# Context Delta Docs

Context Delta is the context packet layer for AI coding agents: inspectable,
replayable, local-first by default, measurable, and portable across tools.

It helps developers keep using the tools they already like while giving those
tools better context:

- GitHub Copilot
- VS Code
- Claude Code
- Cursor
- MCP-compatible agents
- Spec Kit
- spec-driven development workflows

## The Short Version

AI coding agents often struggle because context is stale, noisy, incomplete,
or hidden. Context Delta prepares a small, fresh, inspectable working set
before the agent acts, then exposes a risk header and handoff by default. The
packet remains the audit trail, not the workflow.

```text
Prompt -> Context Delta -> Risk header + handoff -> AI coding agent
```

## What The Packet Shows

- what changed
- what files, tests, specs, and instructions matter
- what was excluded
- why each item was included or excluded
- estimated token savings
- useful-context density and packet-quality eval scores
- readiness insight and risk level
- packet history and previous/current diffs
- approval and replay artifacts
- prompt-ready handoff formats
- freshness warnings

## GitHub Pages

The GitHub Pages landing page is [index.html](index.html). This Markdown file
is kept as a docs index for people browsing the repository source.

Start with the [README](../README.md), then read:

- [Vision](vision.md)
- [Spec-driven development](spec-driven-development.md)
- [CLI](cli.md)
- [Configuration](configuration.md)
- [Insights and previews](insights-and-previews.md)
- [Observability](observability.md)
- [Metrics](metrics.md)
- [Packet-quality eval](eval.md)
- [Blog](blog.html)
- [Testing](testing.md)
- [Release readiness](release.md)
- [VS Code extension](vscode-extension.md)
- [MCP client setup](mcp-client-setup.md)
- [Overnight build plan](overnight-build-plan.md)
- [Demo script](demo-script.md)
- [Known limitations](known-limitations.md)
- [GitHub Pages landing page](site/README.md)
- [Roadmap](roadmap.md)
