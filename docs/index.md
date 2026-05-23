# Context Delta

Context Delta is a local-first context layer for AI coding agents and
spec-driven development.

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
or hidden. Context Delta creates a small, fresh, inspectable context packet
before the agent acts.

```text
Prompt -> Context Delta -> Context Packet -> AI coding agent
```

## What The Packet Shows

- what changed
- what files, tests, specs, and instructions matter
- what was excluded
- why each item was included or excluded
- estimated token savings
- freshness warnings

## Future Website

This page is intentionally simple for now. It can become the GitHub Pages
landing page when the project is ready for a public website.

Start with the [README](../README.md), then read:

- [Vision](vision.md)
- [Spec-driven development](spec-driven-development.md)
- [Metrics](metrics.md)
- [Roadmap](roadmap.md)

