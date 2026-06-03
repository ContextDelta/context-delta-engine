# Architecture

This document describes the intended architecture. It is a design target, not
an implementation guarantee.

## High-Level Flow

```text
Developer prompt
  -> Signal collection
  -> Delta detection
  -> Context ranking
  -> Packet building
  -> Packet viewer
  -> Agent delivery
  -> Metrics, diff, and replay
```

## Core Components

### VS Code Extension

User-facing surface:

- activity bar dashboard
- packet preview
- insight headline and risk level
- token estimate
- include/exclude reasons
- pin, exclude, expand, compact controls
- item actions and prompt-ready handoff copy
- current workspace status
- metrics summary

### Local Engine

Local runtime that:

- scans workspace files
- tracks local snapshots
- reads git diff when available
- parses markdown specs and docs
- detects instruction files
- finds related tests
- builds context packets
- builds insight and compact preview surfaces
- builds packet diffs and handoff formats
- stores packet history
- emits metrics
- writes manager summaries

### MCP Server

Portable integration layer for agents:

- prepare context as one agent-first handoff
- get current packet
- explain packet
- get packet insights
- get compact packet preview
- diff packets
- render agent handoffs
- generate manager summaries
- expand context
- pin or exclude context items
- fetch recent deltas
- fetch metrics

### Packet Store

Local storage for:

- packet metadata
- packet hashes
- source IDs
- token estimates
- user overrides
- metrics events

Raw source code should remain in the repository. The packet store should keep
only the metadata needed for replay and audit unless the user opts into
storing packet text.

## Context Packet Shape

Example:

```json
{
  "schema_version": "0.1",
  "intent": {
    "summary": "Add refresh token rotation for admin users",
    "confidence": 0.86
  },
  "changed_artifacts": [
    {
      "type": "file",
      "path": "src/auth/service.ts",
      "reason": "Recently changed and directly matches task intent"
    }
  ],
  "impacted_neighbors": [
    {
      "type": "test",
      "path": "tests/auth/admin-refresh.test.ts",
      "reason": "Nearest behavior test for admin refresh flow"
    }
  ],
  "governing_constraints": [
    {
      "type": "instruction",
      "path": ".github/copilot-instructions.md",
      "section": "Security",
      "reason": "Token handling rule applies"
    }
  ],
  "excluded": [
    {
      "path": "docs/legacy-oauth.md",
      "reason": "Historical overlap only, no current requirement delta"
    }
  ],
  "metrics": {
    "packet_tokens_estimate": 7800,
    "baseline_tokens_estimate": 28000,
    "context_reduction_percent": 72.1
  }
}
```

## Ranking Signals

Ranking is local, deterministic, and explainable. Implemented today:

- git diff or local snapshot diff (changed files)
- file-kind weighting (instruction, spec, test, source, doc)
- path and filename keyword match
- **content relevance**: task terms found in the file's text
- **declared-symbol match**: task terms landing on function/class/type/def/func
  names the file defines (language-aware extraction for JS/TS, Python, Go)
- **IDF weighting**: rare, discriminating terms count for more than common ones,
  so domain relevance (auth, payments, billing, ...) emerges from the repo's own
  content rather than a hardcoded keyword list
- import/reference proximity (source graph), coverage edges, spec→code edges
- markdown heading relevance
- instruction file scope and closest-file-wins precedence
- user pins and exclusions

The content + symbol + IDF index is built locally per packet — no embeddings and
no model calls — keeping ranking auditable and offline.

## Performance

Everything runs locally and deterministically. On a synthetic 1,000-file
TypeScript repo (`npm run benchmark`), the per-task work measures:

| Stage | mean |
| --- | --- |
| Workspace scan + classify | ~80 ms |
| Full packet assembly (scan + graph + index + rank + tokenize) | ~570 ms |

These are wall-clock numbers on a single machine and scale with repo size; the
benchmark is reproducible from a clean checkout.

Later ranking can add:

- embeddings
- tree-sitter / LSP-backed symbols and references
- cross-repo graph
- PR and issue signals
- CI and diagnostics

## Local-First Storage

Possible local storage:

- SQLite for metadata, packets, and metrics
- file hash index for snapshots
- optional vector store for semantic retrieval

Suggested local folders:

```text
.contextdelta/cache/
.contextdelta/index/
.contextdelta/local/
.contextdelta/reports/
```

Cache and index data should be ignored by git. Reports may be generated for
optional sharing or aggregation.

## Design Principles

- Do not require git.
- Do not require a specific agent.
- Do not require a new developer workflow.
- Keep raw code local by default.
- Show the packet before or after use.
- Make exclusions visible.
- Prefer graceful degradation over hard failure.
- Keep adapters thin and replaceable.
