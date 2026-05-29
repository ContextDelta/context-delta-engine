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

Status:

```text
Initial version implemented.
```

Deliverables:

- workspace scanner
- local snapshot baseline
- git diff support when available
- markdown/spec parser
- instruction detector
- AGENTS.md / CLAUDE.md / Copilot / Cursor instruction precedence
- basic related-test finder
- source graph neighbor detection for changed files
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

Status:

```text
Initial VS Code dashboard, packet viewer, item actions, insights, compact
preview, packet diff, handoff copy, manager summary, and HTML report
implemented.
```

Deliverables:

- VS Code side panel, initial implemented
- packet preview, initial implemented
- token estimate, implemented
- included/excluded reasons, implemented
- freshness status, implemented as warnings and insights
- compact preview, implemented
- pin and exclude controls, implemented through CLI/config and VS Code item actions
- expand controls
- packet history and latest diff, implemented
- packet approval and replay prompts, implemented

Exit criteria:

- user can inspect, pin, exclude, copy, and open packet items before using it
- user can see estimated token savings
- user can compare with a previous packet

## Phase 3: MCP Integration

Goal:

```text
Expose the local context engine to multiple AI coding agents.
```

Status:

```text
Initial MCP stdio server implemented with packet, explain, insight, compact,
diff, handoff, summary, report, scan, metrics, and resource read/list support.
```

Deliverables:

- local MCP server, initial implemented
- get_context_packet tool, implemented
- explain_context_packet tool, implemented
- get_context_insights tool, implemented
- get_compact_context_packet tool, implemented
- diff_context_packets tool, implemented
- render_context_handoff tool, implemented
- generate_manager_summary tool, implemented
- expand_context tool
- packet eval, approval, and replay tools, implemented
- recent delta resource
- current packet, compact packet, insights, diff, handoff, report, manager
  summary, and metrics resources, implemented

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
- useful-context density
- packet-quality eval harness and demo gold set
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
