# GitHub Copilot Workflows

Context Delta should make GitHub Copilot workflows clearer and more reliable
without asking developers to abandon Copilot.

## Positioning

GitHub Copilot is the coding assistant.

Context Delta is the context preparation layer.

```text
Developer asks Copilot
Context Delta prepares the packet
Copilot receives a smaller, fresher working set
```

## What Context Delta Adds

Copilot already supports repo instructions, prompt files, agent workflows,
and integrations. Context Delta should add:

- changed-context detection
- spec-driven context selection
- related test discovery
- stale context warnings
- visible packet preview
- token and packet-size estimates
- optional MCP delivery

## Example Flow

Developer prompt:

```text
Update admin refresh token behavior.
```

Context Delta prepares:

```text
Changed:
- src/auth/service.ts

Related:
- src/auth/token-store.ts
- tests/auth/admin-refresh.test.ts

Spec:
- specs/admin-auth/spec.md#refresh-token-rotation

Instructions:
- .github/copilot-instructions.md#security

Excluded:
- docs/legacy-oauth.md
  Reason: historical note, no current requirement delta
```

The developer can inspect the packet before sending it to Copilot or expose
it through supported integration surfaces as the project matures.

## Design Goals

- Do not replace Copilot.
- Do not depend on hidden prompt internals.
- Use documented extension and MCP-style surfaces where possible.
- Let users keep normal Copilot habits.
- Make context visible when users need to debug an answer.

## README Message For Copilot Users

```text
Use Copilot as usual. Context Delta prepares a focused context packet from
your changed files, specs, tests, and repo instructions so Copilot has less
noise and fewer missing signals.
```

