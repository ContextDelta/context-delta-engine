# MCP Multi-Host Conformance

Context Delta exposes one local engine to many agent hosts over MCP. "Works in
my client" is not enough — the server has to honor the parts of the protocol
that each host actually exercises on connect and during a session. This page is
the published conformance contract and the checklist for validating a new host.

The automated harness backs every claim here:

```bash
npm run mcp:conformance
```

It spawns the real stdio server (`packages/mcp-server/bin/context-delta-mcp.js`)
and drives it over JSON-RPC exactly as a host would, asserting 31 behaviors
across handshake, discovery, invocation, error semantics, and resource reads. It
runs as part of `npm run release:check`, so a regression in host compatibility
fails the release gate, not just a hand test in one editor.

## Why this is host-agnostic

Claude Code, Cursor, Windsurf, and GitHub Copilot are proprietary clients we
can't install in CI. But they are all MCP clients: they speak the same stdio
JSON-RPC wire protocol. The harness speaks that protocol directly, so a green
run is evidence that the calls those hosts make will succeed — without needing
each client present. Where a host needs a specific live walkthrough, the manual
checklist at the bottom covers it.

## Conformance contract

### Lifecycle

| Behavior | Requirement | Verified |
| --- | --- | --- |
| `initialize` | Returns `serverInfo.name`/`version`, `capabilities.tools`, `capabilities.resources`, and a `protocolVersion`. | ✅ |
| Version negotiation | Echoes the client's `protocolVersion` when supported (`2025-06-18`, `2025-03-26`, `2024-11-05`); otherwise answers with the newest supported; falls back to a default when none is sent. | ✅ |
| `notifications/initialized` | Processed silently — a notification (no `id`) must produce no response. | ✅ |
| `ping` | Returns an empty result for liveness checks. | ✅ |

### Discovery

| Behavior | Requirement | Verified |
| --- | --- | --- |
| `tools/list` | Non-empty array; every tool has a `name`, `description`, and an object `inputSchema`. | ✅ |
| `resources/list` | Non-empty array; every resource has `uri`, `name`, and `mimeType`. | ✅ |
| `resources/templates/list` | Returns `{ resourceTemplates: [] }` — a clean no-op, not an error, for hosts that probe it on connect. | ✅ |
| `prompts/list` | Returns `{ prompts: [] }` — a clean no-op for hosts that probe it even though no prompts capability is advertised. | ✅ |

### Invocation

| Behavior | Requirement | Verified |
| --- | --- | --- |
| `tools/call prepare_context` | Returns text `content` plus `structuredContent` with a `Context ready` risk header. | ✅ |
| `tools/call render_context_handoff` | Returns non-empty prompt-ready text. | ✅ |
| `resources/read` | Returns `contents[]` with `uri`, `mimeType`, and `text`; JSON resources parse, `text/plain` resources carry the expected line. | ✅ |

### Error semantics

| Behavior | Requirement | Verified |
| --- | --- | --- |
| Tool runtime error | Reported **inside the result** as `isError: true`, never as a JSON-RPC transport error, so the agent can read and recover (e.g. "no packet yet — run `prepare_context`"). | ✅ |
| Unknown tool name | Returns an `isError` result rather than hard-failing the host. | ✅ |
| Unknown method | JSON-RPC error code `-32601` (method not found). | ✅ |
| Malformed JSON line | JSON-RPC error code `-32700` (parse error) with a `null` id. | ✅ |
| Request `id: 0` | Honored as a real id (not treated as a missing/falsy id). | ✅ |

The split is deliberate and matches the MCP spec: **protocol** failures
(unknown method, malformed input) use the JSON-RPC error channel, while **tool
execution** failures travel inside the tool result so the model sees them.

## Per-host notes

| Host | Path | Notes |
| --- | --- | --- |
| **Claude Code** | stdio MCP server | Add via `mcpServers` config; calls `initialize` → `notifications/initialized` → `tools/list` and may `ping`. Fully covered by the contract above. |
| **Cursor** | stdio MCP server | Probes `resources/templates/list` and `prompts/list` on connect; both are clean no-ops. |
| **Windsurf** | stdio MCP server | Standard lifecycle + tool calls; covered. |
| **GitHub Copilot / VS Code** | Agent mode MCP, when enabled | MCP tools are not exposed in every Copilot environment. When the host cannot call MCP, use the VS Code extension's prepare-and-copy action as the fallback (see [github-copilot.md](github-copilot.md)). |

All hosts share the same config shape; point the command at the server binary
and set `CONTEXT_DELTA_WORKSPACE` if the host does not pass a workspace root:

```json
{
  "mcpServers": {
    "context-delta": {
      "command": "node",
      "args": ["/absolute/path/to/context-delta-engine/packages/mcp-server/bin/context-delta-mcp.js"],
      "env": { "CONTEXT_DELTA_WORKSPACE": "/absolute/path/to/your/repo" }
    }
  }
}
```

## Manual host walkthrough

Run once per real host to confirm the end-to-end UX (the wire protocol is
already covered by `npm run mcp:conformance`):

- [ ] Host lists Context Delta tools and shows `prepare_context`.
- [ ] Asking a coding question triggers (or lets you trigger) `prepare_context`.
- [ ] The returned handoff includes a `Context ready · risk=...` header.
- [ ] `review_context_drift` is callable after edits.
- [ ] A tool error (e.g. calling `explain_context_packet` before any packet
      exists) surfaces as recoverable text, not a host crash.
- [ ] Host can read `contextdelta://packet/current` and `contextdelta://packet/risk`.

## Adding a new host

1. Add the host's config block to its MCP settings using the shape above.
2. Run `npm run mcp:conformance` to confirm the wire contract still holds.
3. Walk the manual checklist in the live host.
4. Add a row to the per-host table with any host-specific quirks.
