# Known Limitations

Context Delta is a strong alpha foundation, not a finished enterprise
product.

## Current Limits

- Ranking is content-, symbol-, and IDF-aware but still local and lexical —
  not embedding-backed yet (by design: no model calls).
- Symbols are extracted with lightweight language-aware patterns (JS/TS, Python,
  Go, Rust, Java, Ruby, PHP), not a full tree-sitter/LSP parse yet.
- One structural ranking heuristic remains for static-site/page review
  (HTML/CSS/JS under asset directories); broader eval coverage is needed before
  it can be generalized away.
- VS Code extension is not packaged for marketplace install.
- MCP server passes an automated multi-host conformance contract over the wire
  (`npm run mcp:conformance`), but per-host UX still needs a live walkthrough in
  each real client (see [mcp-conformance.md](mcp-conformance.md)).
- Delivered token counts are exact (real tokenizer); size-derived baselines are
  estimates, labeled as such.
- HTML reports are local files, not hosted dashboards.
- Packet diff and replay prompt exist, but richer replay comparison UI is still
  planned.
- Pin/exclude controls exist through config, CLI, and VS Code path controls;
  expansion controls are still planned.
- The feedback flywheel learns from a workspace's own drift history; it does not
  yet aggregate across repos (by design — local-first).
- End-to-end task-success eval (run an agent with/without the packet and measure
  completion) is planned; ContextBench currently measures path-level correctness.
- Shipping as a native Spec Kit plugin needs that ecosystem's extension API;
  today Context Delta detects and scopes Spec Kit layouts but is a separate tool.

## Why This Is Still Useful

The engine already covers the full product shape:

- local packet generation; git and no-git delta paths
- content/symbol/IDF ranking + a deterministic multi-language import graph
  (JS/TS, Python, Go, Rust, Java, Ruby, PHP) with coverage and spec→code edges
- spec freshness (deprecated specs kept out) and instruction precedence
- signature-skeleton compression for distant context
- a local feedback flywheel that learns from drift misses
- privacy-safe metrics, redaction, and a governance/compliance block with
  context contracts and a token ceiling
- a published, enforced packet-format contract (JSON Schema + validator)
- ContextBench: a reproducible correctness benchmark with a contribution path
- a regression safety net (eval, e2e, MCP conformance, packet contract, and a
  performance guard)
- MCP surface with a multi-host conformance harness; PR transparency Action
- VS Code dashboard, packet history/diff, handoff formats, local report, summary

The next work is depth where it needs external inputs: embedding/tree-sitter
ranking, marketplace packaging, live multi-host walkthroughs, end-to-end
task-success eval, and a native Spec Kit plugin.
