# Scaling

Context Delta should start simple and local, then scale without changing the
core user promise.

The promise stays the same:

```text
Give the AI agent the right context for this task.
```

The implementation can grow underneath it.

## Scale Dimension 1: From No Git To Rich Git

Context Delta should not require git.

Signal ladder:

```text
Local snapshots
  -> file save history
  -> active files
  -> git diff
  -> branches and commits
  -> pull requests
  -> issues and review threads
```

Each layer improves the packet, but the product should still work when a
layer is missing.

## Scale Dimension 2: From One Repo To Many Repos

Start:

```text
single local workspace
```

Then:

```text
monorepo package/service scopes
```

Later:

```text
multi-repo dependency and ownership graph
```

At multi-repo scale, packets need stronger boundaries:

- allowed repos
- source ownership
- dependency edges
- service contracts
- privacy policy
- per-repo freshness status

## Scale Dimension 3: From Local Metrics To Org Metrics

Start with local metrics:

```text
.contextdelta/reports/session-metrics.jsonl
```

Then repo summaries:

```text
.contextdelta/reports/weekly-summary.json
```

Then GitHub Action summaries:

```text
Context Delta Weekly Report
- estimated tokens saved
- average packet size
- packet override rate
- stale spec warnings
```

Later, org dashboards can aggregate privacy-safe events across repositories.

## Scale Dimension 4: From Simple Ranking To Rich Context Graph

Initial ranking:

- active files
- changed files
- filename and heading matches
- test proximity
- local snapshots
- instructions

Next ranking:

- tree-sitter symbols
- import and reference graph
- embeddings
- diagnostics
- packet history

Advanced ranking:

- PR and issue context
- cross-repo dependencies
- code owners
- service contracts
- CI failure signals
- spec-to-code traceability

## Scale Dimension 5: From Open Source To Commercial Layer

Open-source core:

- local engine
- packet builder
- VS Code viewer
- MCP server
- local metrics
- examples and benchmark harness

Possible commercial layer later:

- team dashboard
- encrypted sync
- policy controls
- audit retention
- hosted connectors
- SSO and SCIM
- on-prem or air-gapped deployment
- multi-repo impact graph

The commercial layer should sell control, observability, and governance. The
open-source layer should remain genuinely useful on its own.

## Performance Principles

- index incrementally
- avoid full repo scans on every prompt
- keep packet building fast enough for normal agent workflows
- cache parsed markdown and symbols
- invalidate by file hash and dependency neighborhood
- lazy-load large docs, logs, and generated files

## Trust Principles

At scale, users trust the system when they can see:

- packet contents
- packet freshness
- included reasons
- excluded reasons
- metrics estimates
- policy decisions
- replay history

The packet viewer is not a nice-to-have. It is the trust surface.

