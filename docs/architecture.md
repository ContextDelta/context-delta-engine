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
  -> Metrics and replay
```

## Core Components

### VS Code Extension

User-facing surface:

- packet preview
- token estimate
- include/exclude reasons
- pin, exclude, expand, compact controls
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
- stores packet history
- emits metrics

### MCP Server

Portable integration layer for agents:

- get current packet
- explain packet
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

Initial ranking should be explainable:

- active file and selection
- exact filename or symbol match
- git diff or local snapshot diff
- markdown heading relevance
- test filename proximity
- import/reference proximity
- instruction file scope
- recency
- user pins and exclusions

Later ranking can add:

- embeddings
- tree-sitter symbols
- LSP references
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

