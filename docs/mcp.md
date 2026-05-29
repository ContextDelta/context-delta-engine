# MCP Integration

MCP gives Context Delta a portable way to serve context packets to different
AI coding agents.

The goal is simple:

```text
One local context engine, many agent clients.
```

## Why MCP Matters

Developers use different tools:

- VS Code
- GitHub Copilot
- Claude Code
- Cursor
- local agent CLIs
- custom internal agents

Context Delta should not require every integration to be custom. MCP can
expose context packet tools and resources in a way that multiple hosts can
use.

## Current Tools

The first dependency-light stdio server exposes:

```text
prepare_context(task?)
check_context_setup(workspaceRoot, target?)
review_context_drift(workspaceRoot)
get_context_packet(task)
explain_context_packet(workspaceRoot)
get_context_insights(workspaceRoot)
get_compact_context_packet(workspaceRoot)
generate_context_report(workspaceRoot)
get_context_history(workspaceRoot)
diff_context_packets(workspaceRoot)
render_context_handoff(workspaceRoot, format)
run_context_eval(workspaceRoot)
approve_context_packet(workspaceRoot, decision)
render_context_replay(workspaceRoot)
generate_manager_summary(workspaceRoot)
scan_workspace(workspaceRoot)
get_context_metrics(workspaceRoot)
```

Run it locally:

```bash
npm run mcp
```

Check readiness for an MCP-capable host:

```bash
npm run setup -- --target mcp
npm run doctor -- --mcp
```

Example host config shape:

```json
{
  "mcpServers": {
    "context-delta": {
      "command": "node",
      "args": [
        "/absolute/path/to/context-delta-engine/packages/mcp-server/bin/context-delta-mcp.js"
      ],
      "env": {
        "CONTEXT_DELTA_WORKSPACE": "/absolute/path/to/your/repo"
      }
    }
  }
}
```

In a host that supports MCP tools, ask normally but make the first instruction
explicit during alpha testing:

```text
Before reviewing or editing, call prepare_context for this task and use the
returned handoff as your focused context.
```

The server currently implements the core JSON-RPC methods needed for an MCP
tool surface:

```text
initialize
tools/list
tools/call
resources/list
resources/read
```

Current resources:

```text
contextdelta://packet/risk
contextdelta://packet/current
contextdelta://packet/insights
contextdelta://packet/compact
contextdelta://packet/diff
contextdelta://packet/drift
contextdelta://setup/status
contextdelta://handoff/markdown
contextdelta://packet/replay
contextdelta://metrics/session
contextdelta://metrics/manager-summary
contextdelta://report/latest
```

## Future Tools And Resources

Planned tools:

```text
expand_context(packet_id, scope)
pin_context_item(path_or_id)
exclude_context_item(path_or_id)
get_recent_deltas()
```

Planned resources:

```text
contextdelta://packet/{packet_id}
contextdelta://deltas/recent
contextdelta://rules/current
```

## Example Agent Flow

```text
1. User asks agent to modify auth behavior.
2. Agent calls prepare_context(task).
3. Context Delta returns a risk header and prompt-ready handoff.
4. Agent uses the handoff to plan and edit.
5. Agent calls review_context_drift before finalizing when files changed.
6. Context Delta logs packet metadata and estimated savings locally.
```

`get_context_packet`, compact previews, diffs, reports, eval, approval, and
replay tools remain available for audit and debugging. The agent-first path is
`prepare_context`; the follow-up safety check is `review_context_drift`.

## Safety Principles

- Local-first by default.
- Packet assembly and storage stay local by default; sharing a packet with an
  MCP host or agent is explicit and user-controlled.
- Packet contents must be inspectable.
- Exclusions and redactions must be honored consistently.
- Metrics should not include raw prompt text or source code by default.

## Open Questions

- Which hosts expose the best MCP user experience?
- Should the agent request a packet automatically or should users opt in?
- How should packet approval work in terminal-first tools?
- How should policies apply when hosts have different capabilities?
