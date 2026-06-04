# The Context Delta Packet Format

The packet is the product's signature artifact: a portable, inspectable record of
exactly what context an agent was handed and why. Because other tools (and your
own CI) should be able to rely on it, the structure is a **contract**, not an
implementation detail.

- **Published schema:** [`packet.schema.json`](packet.schema.json) (JSON Schema
  2020-12) — for external consumers and interop.
- **Authoritative check:** `packages/engine/src/packet-schema.js` — enforced in
  tests and via `npm run validate:packet`, which builds packets for the bundled
  workspaces and validates them. A drift in structure fails the build before it
  reaches anyone downstream.

## Top-level shape

| Field | Type | Meaning |
| --- | --- | --- |
| `schema_version` | string | Packet contract version. |
| `id` | string | Stable content hash of the packet. |
| `created_at` | string | ISO timestamp. |
| `intent` | object | `task`, derived `keywords`, and a confidence score. |
| `changed_artifacts` | item[] | What changed (git or snapshot delta). |
| `supporting_evidence` | item[] | Spec sections, docs, and nearby/covering tests. |
| `governing_constraints` | item[] | Instruction files/sections (closest-file-wins). |
| `impacted_neighbors` | item[] | Graph-reachable files; distant ones are signature skeletons. |
| `excluded` | object[] | What was left out, each with a `reason`. |
| `warnings` | object[] | Typed warnings (stale-spec, budget-over-target, policy-violation, …). |
| `budget` | object | Mode, tier, `target_tokens`, `pressure`, and token `allocation`. |
| `metrics` | object | Delivered/baseline tokens, reduction, tokenizer method, baseline spectrum. |
| `summary` | object | Included/excluded/spec/test counts. |
| `workspace` | object | `root`, git state, monorepo detection. |
| `controls` | object | Active pins/excludes and mode. |
| `compliance` | object | Governance: policy exclusions, redactions, token-ceiling status, `violations`. |
| `spec_review` | object | Deprecated/superseded specs kept out of the packet. |
| `insights` / `compact_view` | object | Risk/recommendations and a content-free preview. |

Each **item** (in the four delivered arrays) has a string `type` and a `path`
and/or `heading`, plus optional `reason`, `kind`, `content`, and
`tokens_estimate`.

## Invariants the validator enforces

Beyond field presence and types:

- `metrics.delivered_tokens_estimate` ≤ `metrics.baseline_tokens_estimate` — a
  packet can never claim to deliver more than its own baseline.
- `metrics.context_reduction_percent` ∈ [0, 100].
- Every delivered item is identifiable (`path` or `heading`) and typed.
- Every excluded item carries a `path`.

## Why a stable format matters

- **Interop / no lock-in** — any tool can read or emit the packet; the engine is
  swappable, the artifact is the standard.
- **Trust** — reviewers and CI validate the exact structure; "what did the agent
  get?" has a precise, machine-checkable answer.
- **No silent drift** — a change to packet shape that isn't intended fails
  `npm run validate:packet` (part of `release:check`).

Validate locally:

```bash
npm run validate:packet
```
