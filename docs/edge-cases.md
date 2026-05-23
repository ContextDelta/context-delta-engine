# Edge Cases

Context Delta has to work in normal messy repositories, not only clean demo
projects.

The product should degrade gracefully. When one signal is missing, it should
use the next best signal instead of failing.

## Repository And Workflow Edge Cases

| Scenario | Expected behavior |
| --- | --- |
| No git repository | Use local snapshot diffing from first index. |
| Git unavailable | Continue with file saves, snapshots, active files, and docs. |
| Huge repo | Index incrementally, ignore generated folders, lazy-load deep context. |
| Monorepo | Let users scope to packages, services, or folders. |
| Multiple repos | Start single-repo, later support linked repos and org graphs. |
| Detached worktree | Use local file state and best-effort branch metadata. |
| Renamed files | Detect by content hash and similarity, not only path. |
| Generated files | Exclude by default unless pinned. |
| Binary files | Track metadata only unless an extractor is configured. |
| Vendored dependencies | Exclude by default. |

## Spec And Documentation Edge Cases

| Scenario | Expected behavior |
| --- | --- |
| No specs | Use code, tests, docs, instructions, and active files. |
| Many old specs | Rank by recency, links, changed units, and semantic relevance. |
| Conflicting specs | Show a conflict warning instead of silently choosing. |
| Stale spec | Warn when code and spec appear out of sync. |
| Non-standard spec folders | Let users add folders and patterns. |
| Huge markdown docs | Parse by heading and include only relevant sections. |
| Task files completed | Mark as historical unless referenced by current work. |

## Agent And Editor Edge Cases

| Scenario | Expected behavior |
| --- | --- |
| User does not want a new workflow | Run quietly and show packet only on demand. |
| User wants control | Provide inspect, pin, exclude, expand, and compact controls. |
| Agent asks for missing context repeatedly | Auto-suggest expanding the packet. |
| Host has limited integration | Offer copy/export and MCP fallback. |
| Host changes APIs | Keep adapters thin and rely on documented surfaces. |
| User distrusts pruning | Offer conservative mode with broader packets. |

## Security And Privacy Edge Cases

| Scenario | Expected behavior |
| --- | --- |
| Secrets or env files | Exclude and redact by default. |
| Private code | Local-first indexing and packet generation. |
| Metrics export | No raw code or prompt text by default. |
| Enterprise policy | Apply allowlists, denylists, redaction, and audit settings. |
| Cloud sync disabled | Full local mode should still work. |
| Sensitive directory | Respect exclusion rules across all adapters. |

## Quality Edge Cases

| Scenario | Expected behavior |
| --- | --- |
| Sparse graph | Broaden semantic and filename retrieval. |
| Unsupported language | Use text, filenames, imports, docs, and tests first. |
| No tests | Include nearest examples and show "no test coverage detected." |
| Large logs | Extract relevant lines around errors and stack traces. |
| Stale index | Show freshness warning and trigger reindex. |
| Ambiguous prompt | Widen packet or ask for clarification through the host. |

## Principle

Best case:

```text
Rich git, spec, symbol, test, and instruction-aware packet.
```

Worst case:

```text
Still useful packet from active files, recent saves, local snapshots,
docs, tests, and user intent.
```

Context Delta should never require every signal to exist before it can help.

