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

## Proposed Tools

Initial MCP tools:

```text
get_context_packet(task)
explain_context_packet(packet_id)
expand_context(packet_id, scope)
pin_context_item(path_or_id)
exclude_context_item(path_or_id)
get_recent_deltas()
get_context_metrics(range)
```

## Proposed Resources

Initial MCP resources:

```text
contextdelta://packet/current
contextdelta://packet/{packet_id}
contextdelta://deltas/recent
contextdelta://metrics/session
contextdelta://rules/current
```

## Example Agent Flow

```text
1. User asks agent to modify auth behavior.
2. Agent calls get_context_packet(task).
3. Context Delta returns a focused packet.
4. Agent uses the packet to plan and edit.
5. Context Delta logs packet metadata and estimated savings.
```

## Safety Principles

- Local-first by default.
- No raw code leaves the machine unless the user or host sends it.
- Packet contents must be inspectable.
- Exclusions and redactions must be honored consistently.
- Metrics should not include raw prompt text or source code by default.

## Open Questions

- Which hosts expose the best MCP user experience?
- Should the agent request a packet automatically or should users opt in?
- How should packet approval work in terminal-first tools?
- How should policies apply when hosts have different capabilities?

