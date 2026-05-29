# Context Delta VS Code Extension

This is the VS Code extension shell for Context Delta.

It contributes commands:

- `Context Delta: Create Context Packet`
- `Context Delta: Show Latest Packet`
- `Context Delta: Show Packet Insights`
- `Context Delta: Write Local Snapshot`
- `Context Delta: Show Metrics Summary`
- `Context Delta: Open Config File`
- `Context Delta: Generate HTML Report`
- `Context Delta: Show Packet Diff`
- `Context Delta: Generate Manager Summary`
- `Context Delta: Check Setup`
- `Context Delta: Set Up Local Integration`
- `Context Delta: Review Agent Drift`
- `Context Delta: Prepare Current Changes`
- `Context Delta: Copy Latest Packet JSON`
- `Context Delta: Copy Compact Packet`
- `Context Delta: Copy Agent Handoff`
- `Context Delta: Prepare and Copy for Codex`
- `Context Delta: Prepare and Copy for Claude`
- `Context Delta: Prepare and Copy for Copilot`
- `Context Delta: Include Path`
- `Context Delta: Exclude Path`
- `Context Delta: Copy Replay Prompt`
- `Context Delta: Approve Latest Packet`
- `Context Delta: Tune Packet Controls`
- `Context Delta: Remove Stale Packet Controls`
- `Context Delta: Clear Packet Controls`
- `Context Delta: Refresh Dashboard`

The extension calls the local CLI in this repository and renders dashboard,
packet, insight, diff, summary, report, replay, approval, and metrics output in VS Code
webviews.

It contributes a `Context Delta` activity bar view with latest risk, savings,
budget pressure, useful-context density, top paths, and agent-first actions.
The main workflow is one-step: prepare current changes or prepare and copy a
handoff for Codex, Claude, or Copilot. The status bar shows
`Context ready · risk` so developers can keep working normally until a warning
needs attention.

Advanced controls are collapsed by default, but developers can still choose
exact include/exclude paths, tune general presets, open config, inspect context
items, clean stale controls, copy an Agent Handoff, open a Packet Diff, review
agent drift, copy a replay prompt, or record an approval decision before
handing the packet to an agent.

## Development Notes

This package intentionally avoids a build step for the first prototype. The
extension host provides the `vscode` module at runtime.

Use the root `.vscode/launch.json` configuration named `Run Context Delta
Extension` to debug locally.

## Staging

From the repository root:

```bash
npm run vscode:stage
```

This writes a staged extension folder to:

```text
dist/vscode-extension/
```

The staged folder bundles the local CLI, engine, and shared packages under
`vendor/` so the extension does not depend on sibling monorepo packages after
packaging.
