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
- Token counts are estimates.
- HTML reports are local files, not hosted dashboards.
- Packet diff and replay prompt exist, but richer replay comparison UI is still
  planned.
- Pin/exclude controls exist through config, CLI, and VS Code path controls;
  expansion controls are still planned.

## Why This Is Still Useful

The current prototype already proves the product shape:

- local packet generation
- git and no-git delta paths
- spec and instruction parsing
- privacy-safe metrics
- redaction
- packet insights and compact preview
- packet history, packet diff, and handoff formats
- MCP surface
- VS Code dashboard, inspection surface, and item actions
- local report
- manager summary export

The next work should improve quality and integration depth rather than
rethink the product direction.
