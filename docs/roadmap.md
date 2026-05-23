# Roadmap

This roadmap is intentionally staged. The first release should prove the
product experience before attempting enterprise-scale infrastructure.

## Phase 0: Repo Foundation

Goal:

```text
Make the idea understandable and credible.
```

Deliverables:

- sales-quality README
- product docs
- architecture notes
- Spec Kit and spec-driven development positioning
- GitHub Copilot workflow notes
- metrics plan
- edge cases
- examples

Exit criteria:

- a new visitor understands the problem in under one minute
- a developer understands how the tool would fit their workflow
- a manager understands the value and measurement story

## Phase 1: Local Prototype

Goal:

```text
Generate a useful local context packet from a workspace.
```

Deliverables:

- workspace scanner
- local snapshot baseline
- git diff support when available
- markdown/spec parser
- instruction detector
- basic related-test finder
- packet builder
- packet JSON output

Exit criteria:

- command produces a packet for a real repo
- packet includes changed files, relevant docs/specs, and nearby tests
- packet includes excluded items with reasons

## Phase 2: Viewer

Goal:

```text
Make the packet visible and useful.
```

Deliverables:

- VS Code side panel
- packet preview
- token estimate
- included/excluded reasons
- freshness status
- pin, exclude, expand, compact controls
- packet history

Exit criteria:

- user can inspect and edit a packet before using it
- user can see estimated token savings
- user can replay a previous packet

## Phase 3: MCP Integration

Goal:

```text
Expose the local context engine to multiple AI coding agents.
```

Deliverables:

- local MCP server
- get_context_packet tool
- explain_context_packet tool
- expand_context tool
- recent delta resource
- metrics resource

Exit criteria:

- at least two agent clients can consume the same packet
- packet format stays stable across hosts

## Phase 4: Spec-Driven Development Support

Goal:

```text
Make specs first-class context.
```

Deliverables:

- Spec Kit folder detection
- spec/plan/tasks parsing
- changed requirement detection
- stale spec warnings
- spec-to-code trace view
- implementation coverage hints

Exit criteria:

- packet includes specific spec sections instead of whole spec files
- stale or conflicting specs are visible
- developers can see why a spec section was included

## Phase 5: Metrics And Reports

Goal:

```text
Measure context savings and workflow friction.
```

Deliverables:

- local JSONL metrics export
- weekly repo summary
- GitHub Action report
- privacy-safe aggregation schema
- manager-friendly summary view

Exit criteria:

- user can see session-level savings
- repo owners can see weekly trends
- no raw source code or prompt text is exported by default

## Phase 6: Team And Enterprise Layer

Goal:

```text
Support larger organizations without sacrificing transparency.
```

Deliverables:

- optional hosted dashboard
- encrypted sync
- policy engine
- redaction
- audit retention
- multi-repo impact analysis
- SSO and enterprise deployment options

Exit criteria:

- teams can aggregate metrics across repos
- admins can enforce context policies
- sensitive context remains controlled and visible

