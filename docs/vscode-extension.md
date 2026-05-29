# VS Code Extension

The VS Code extension lives in:

```text
packages/vscode-extension/
```

It contributes these commands:

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
- `Context Delta: Install VS Code Extension`
- `Context Delta: Review Agent Drift`
- `Context Delta: Choose Preferred Agent`
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

It also contributes a `Context Delta` activity bar view.

## Current Behavior

Status: alpha preview. The extension is usable from a local checkout and staged
folder, but it is not marketplace-packaged yet and does not intercept closed
agent chats. It prepares context through the local CLI/MCP engine and keeps the
packet available for review.

The extension calls the local CLI and renders dashboard, packet, insight,
metrics, replay, approval, and report views in VS Code webviews.

The dashboard defaults to an agent-first workflow:

- one primary `Prepare Current Changes` action for the preferred agent
- a remembered preferred agent, currently Codex, Claude, or Copilot
- prepare-current-changes that infers the task from branch and diff signals
- a setup check so first-run issues are visible without leaving the editor
- a setup fix action for installing the staged VS Code extension during
  development
- a drift review so users can see whether an agent edited outside the packet
- status bar readiness: `Context ready · risk`
- risk level, estimated tokens saved, useful-context density, and budget
  pressure
- latest packet headline and top selected paths

Advanced controls are collapsed by default. They expose exact agent handoffs,
packet-only creation, path include/exclude, preset tuning, config editing,
reports, metrics, handoff-format selection, replay, approval, and raw/compact
packet actions.

When creating a packet, it asks for:

- task text
- packet mode: `balanced`, `conservative`, or `strict`

For common workflows, the extension uses general signal-driven presets: code
review, docs/content review, test/debug, spec-driven change, and
security-sensitive work. These are based on task and file signals, not
repo-specific strings.

The packet view shows:

- packet insight and risk level
- recommended next steps
- changed, included, spec, test, excluded, saved, useful-density, and reduction
  metrics
- budget pressure
- redaction count
- warnings
- fix buttons for common warnings such as budget pressure or missing specs
- direct copy buttons for Codex, Claude, and Copilot
- collapsed advanced context controls for include path, exclude path, presets,
  stale-control cleanup, rebuild, and clear controls
- collapsed included and excluded context with item-level open, copy, pin, and
  exclude actions
- raw packet JSON collapsed by default

It is intentionally lightweight:

- no marketplace packaging yet
- no hidden prompt interception
- local-first behavior

## Minimum Use Path

```text
1. Run npm run vscode:stage.
2. Run npm run setup -- --fix --target vscode.
3. Reload VS Code.
4. Open the Context Delta activity bar view.
5. Choose the preferred agent once.
6. Use Prepare Current Changes for the preferred agent.
```

For automatic Copilot Agent mode, use the MCP route in
`docs/github-copilot.md`; the extension handoff path is the fallback when the
host does not call MCP tools.

## Debug Locally

Open this repository in VS Code and launch:

```text
Run Context Delta Extension
```

The launch config lives in `.vscode/launch.json`.

## Stage For Packaging

Run:

```bash
npm run vscode:stage
```

This creates:

```text
dist/vscode-extension/
```

The staged extension includes the local CLI, engine, and shared packages under
`vendor/` so the extension can run outside the monorepo layout.

## Next Hardening Steps

- package with `vsce`
- add extension host tests
- add expand controls in the UI
- add richer host-specific MCP setup walkthroughs
