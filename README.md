# Context Delta

**Give your AI coding agent the right context, not the biggest context.**

Context Delta is a local-first context layer for AI coding agents and
spec-driven development. It helps tools like GitHub Copilot, VS Code,
Claude Code, Cursor, and MCP-compatible agents work from a small, fresh,
inspectable packet of context before they make changes.

AI coding tools are powerful. The problem is that they often receive messy
context: stale specs, long chat history, random open files, missing tests,
old instructions, and hidden prompt assembly. Context Delta finds what
changed, finds what matters, removes the noise, and shows what will be sent.

```text
Your prompt
  -> Context Delta
  -> Fresh context packet
  -> GitHub Copilot / Claude Code / Cursor / MCP agent
```

## Why This Exists

Modern AI coding often fails for ordinary reasons:

- the agent sees an old spec instead of the current requirement
- the related test file is missed
- a security instruction is buried in repo docs
- the prompt contains too much unrelated context
- nobody can see what the agent actually used

Context Delta treats context as a working set, not a pile of files.

Before the AI acts, it builds a focused packet:

- what changed
- what is affected
- which spec sections matter
- which tests are nearby
- which repo instructions apply
- what was excluded and why
- how many tokens were likely saved

## The Product Promise

Keep using your existing workflow.

Context Delta should run underneath the tools developers already use:

- GitHub Copilot and VS Code
- Claude Code
- Cursor
- MCP-compatible coding agents
- Spec Kit
- spec-driven development workflows

You should not need to switch IDEs, rewrite your process, or manually paste
giant context blocks. The default experience should be quiet and fast. The
details should be visible when you want to inspect them.

## What A Developer Sees

```text
Context Packet Ready

Task readiness: Good
Changed files: 3
Related tests: 2
Relevant specs: 1
Rules/instructions: 2
Excluded noisy files: 18
Estimated context reduction: 64%
```

Clicking into the packet shows:

- included files and snippets
- reasons for inclusion
- excluded files and reasons
- changed vs unchanged context
- estimated token cost
- freshness warnings
- pin, exclude, expand, and compact controls

## Example

You ask:

```text
Add refresh token rotation for admin users.
```

Without Context Delta, the agent may see:

```text
28,000 tokens
old auth specs, unrelated open files, long chat history, random docs,
and no focused explanation of what changed
```

With Context Delta, the agent receives:

```text
7,800 tokens
changed auth service, affected token store, relevant spec requirement,
security instruction, nearest tests, and excluded stale docs

Estimated context saved: 72%
```

The goal is not smaller context for its own sake. The goal is better context:
fresh enough to be reliable, rich enough to be correct, and visible enough
to trust.

## For Spec-Driven Development

Spec-driven development helps teams describe what should be built.

Context Delta helps AI agents understand which parts of the spec, code,
tests, docs, and history matter right now.

That makes Context Delta a complement to Spec Kit and similar workflows:

```text
Spec-driven development: define intent
Context Delta: deliver the right intent to the agent at the right moment
```

As specs evolve, the hard problem becomes knowing which requirements are
current, which are stale, which code implements them, and which tests prove
them. Context Delta is designed to make that working set visible.

## For Engineering Leaders

Context quality should be measurable.

Context Delta is designed to emit privacy-safe metrics such as:

- estimated input tokens saved
- average packet size
- files/specs/tests included per task
- files excluded as stale or noisy
- manual override rate
- stale spec warnings
- repeated context lookups avoided

At team scale, those metrics can become repo and org summaries:

```text
This month:
- 42M estimated input tokens saved
- 61% average context reduction
- 84% packets accepted without edits
- 19 stale spec warnings
- 31 repeated-context lookups avoided
```

Raw source code and prompt text should not be included in metrics by default.

## How It Works

Context Delta has five layers:

1. **Collect signals**
   Active files, local snapshots, git diff when available, specs, docs,
   tests, instructions, diagnostics, and recent context packets.

2. **Understand change**
   Detect changed files, changed requirement units, related symbols,
   affected tests, and likely stale context.

3. **Build the packet**
   Rank context by relevance, freshness, impact, and trust. Pack only the
   useful pieces into a bounded context packet.

4. **Show the packet**
   Let users see what will be sent, why it was included, what was excluded,
   and how much context was saved.

5. **Deliver to agents**
   Expose the packet through a VS Code extension, MCP server, and agent
   workflow integrations.

## Current Status

Context Delta is an early open-source project in the planning and prototype
phase.

Initial focus:

- clear product story
- local-first design
- VS Code viewer
- MCP server
- spec-driven development support
- GitHub Copilot workflows
- privacy-safe metrics

## Roadmap

Near term:

- local workspace scanner
- local snapshot diffing
- git diff support
- markdown/spec parser
- instruction detector
- basic context packet builder
- packet viewer design
- MCP tool design

Next:

- VS Code extension
- token estimator
- packet history and replay
- pin, exclude, expand, and compact controls
- Spec Kit folder detection
- spec/plan/tasks parsing
- GitHub Copilot workflow examples

Later:

- repo metrics export
- GitHub Action reports
- team dashboard
- policy controls
- redaction
- multi-repo impact analysis
- enterprise deployment options

See [docs/roadmap.md](docs/roadmap.md) for the working roadmap.

## Project Docs

- [Vision](docs/vision.md)
- [Positioning](docs/positioning.md)
- [Spec-driven development](docs/spec-driven-development.md)
- [Spec Kit workflows](docs/spec-kit.md)
- [GitHub Copilot workflows](docs/github-copilot.md)
- [MCP integration](docs/mcp.md)
- [User experience](docs/user-experience.md)
- [Metrics](docs/metrics.md)
- [Scaling](docs/scaling.md)
- [Go to market](docs/go-to-market.md)
- [Architecture](docs/architecture.md)
- [Edge cases](docs/edge-cases.md)
- [Research notes](docs/research-notes.md)

## License

Apache-2.0. See [LICENSE](LICENSE).

## Trademark Notice

Context Delta is an independent open-source project. It is not affiliated
with GitHub, Microsoft, Anthropic, Cursor, OpenAI, or the Spec Kit project.
