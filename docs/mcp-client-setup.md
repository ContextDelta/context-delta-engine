# MCP Client Setup

The MCP server is the lowest-friction path for agentic tools that support MCP:
the agent calls one tool, receives a prompt-ready handoff plus a one-line risk
header, and continues the task without asking the developer to babysit packet
controls.

Run it manually:

```bash
npm run mcp
```

The binary entry is:

```bash
node packages/mcp-server/bin/context-delta-mcp.js
```

## Tools

Primary tool:

- `prepare_context`: builds or refreshes context, infers the task when needed,
  and returns an agent-ready handoff plus `Context ready · risk=...`.

Advanced tools:

- `check_context_setup`
- `review_context_drift`
- `get_context_packet`
- `explain_context_packet`
- `get_context_insights`
- `get_compact_context_packet`
- `generate_context_report`
- `get_context_history`
- `diff_context_packets`
- `render_context_handoff`
- `run_context_eval`
- `approve_context_packet`
- `render_context_replay`
- `generate_manager_summary`
- `scan_workspace`
- `get_context_metrics`

## Resources

Current resources:

- `contextdelta://packet/risk`
- `contextdelta://packet/current`
- `contextdelta://packet/insights`
- `contextdelta://packet/compact`
- `contextdelta://packet/diff`
- `contextdelta://packet/drift`
- `contextdelta://setup/status`
- `contextdelta://handoff/markdown`
- `contextdelta://packet/replay`
- `contextdelta://metrics/session`
- `contextdelta://metrics/manager-summary`
- `contextdelta://report/latest`

## Example JSON-RPC Call

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "prepare_context",
    "arguments": {
      "task": "Add admin refresh token rotation",
      "workspaceRoot": "examples/demo-workspace",
      "format": "markdown",
      "writeOutputs": false
    }
  }
}
```

## Doctor

Check first-run setup:

```bash
npm run setup -- --target mcp
```

Print a one-paste setup hint for the current checkout:

```bash
npm run doctor -- --mcp
```

The output includes:

- the server command
- a generic `mcpServers` JSON block
- the workspace path to set as `CONTEXT_DELTA_WORKSPACE`
- a reminder that `prepare_context` is the normal first call

## Client Direction

Exact config format can vary by host version, but the server command should
point to:

```bash
node /absolute/path/to/context-delta-engine/packages/mcp-server/bin/context-delta-mcp.js
```

Set `CONTEXT_DELTA_WORKSPACE` if the host does not pass a workspace root:

```bash
CONTEXT_DELTA_WORKSPACE=/absolute/path/to/repo
```

GitHub Copilot does not universally expose arbitrary MCP tools in every
environment. When a host cannot call MCP directly, use the VS Code extension's
prepare-and-copy action as the fallback.

## Validation Checklist

- host can list tools
- host can call `prepare_context`
- `prepare_context` returns a risk header and handoff text
- host can call `review_context_drift` after edits
- host can call `check_context_setup` when setup is unclear
- host can call `get_context_insights`
- host can call `get_compact_context_packet`
- host can call `render_context_handoff`
- host can call `render_context_replay`
- host can call `diff_context_packets`
- packet includes expected specs/tests/instructions
- host can read `contextdelta://packet/current`
- host can read `contextdelta://packet/risk`
- host can read `contextdelta://packet/compact`
- host can read `contextdelta://packet/drift`
- host can read `contextdelta://setup/status`
- host can read `contextdelta://handoff/markdown`
- report generation returns a local HTML path
