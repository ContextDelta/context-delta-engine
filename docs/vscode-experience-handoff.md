# VS Code Experience Handoff

This document is for continuing the VS Code and product-experience work.

The extension is now more than a command shell. It has a Context Delta
activity bar view, packet previews, packet insights, compact-copy handoff,
metrics, reports, and config/snapshot utilities.

## Current Commands

- `Context Delta: Create Context Packet`
- `Context Delta: Show Latest Packet`
- `Context Delta: Show Packet Insights`
- `Context Delta: Write Local Snapshot`
- `Context Delta: Show Metrics Summary`
- `Context Delta: Write Config File`
- `Context Delta: Generate HTML Report`
- `Context Delta: Copy Latest Packet JSON`
- `Context Delta: Copy Compact Packet`
- `Context Delta: Refresh Dashboard`

## Current UX

The activity bar dashboard shows:

- latest risk level
- estimated tokens saved
- context reduction
- budget pressure
- latest packet insight
- top selected paths
- create, open, insight, report, metrics, snapshot, config, and copy actions

When creating a packet, the extension asks for:

1. task text
2. packet mode: `balanced`, `conservative`, or `strict`

Then it runs the local CLI and shows a webview with:

- packet insight and risk
- recommended next steps
- changed count
- included count
- spec count
- test count
- excluded count
- savings estimate
- budget pressure
- redaction count
- warnings
- pinned/excluded controls
- included context
- excluded context
- raw packet JSON

## Next Best VS Code Work

### Item-Level Actions

Add item-level actions:

- pin file
- exclude file
- open file
- copy snippet
- expand around file

The engine already accepts `--pin` and `--exclude`.

### Packet Diff View

Show:

```text
previous packet -> current packet
```

Useful sections:

- newly included
- removed
- changed reason
- budget change
- warning changes

### Agent Handoff

Keep improving copy commands:

- copy full packet
- copy compact packet
- copy only changed/spec/test buckets
- copy prompt-ready markdown

This helps GitHub Copilot users before deeper native integration exists.

### Extension Packaging

Add:

- `vsce` packaging
- extension host tests
- screenshots
- marketplace README
- quickstart GIF

## Design Direction

The UI should feel like an inspection panel, not a marketing page.

Prioritize:

- clarity
- compact sections
- source paths
- reasons
- warnings
- copy/open actions
- fast confirmation that the packet is safe to use

Avoid:

- marketing text inside the tool
- giant hero styling
- forcing users through setup screens

The extension should stay quiet until a user wants to inspect or control the
packet.
