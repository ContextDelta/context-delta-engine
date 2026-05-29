# GitHub Copilot Workflows

Context Delta should make GitHub Copilot workflows clearer and more reliable
without asking developers to abandon Copilot.

Status: GitHub Copilot support is alpha and depends on the host. In VS Code,
Copilot Agent mode can use the Context Delta MCP server when MCP tools are
enabled. If MCP tools are unavailable, use the VS Code prepare-and-copy
handoff.

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
- Copilot-ready handoff copy
- packet diff when context changes between attempts
- optional MCP delivery

## Example Flow

Minimum automatic test in VS Code:

```text
1. Run npm run setup -- --target mcp.
2. Reload VS Code and open this repository.
3. Open Copilot Chat in Agent mode.
4. Make sure the context-delta MCP server/tool is enabled.
5. Ask for a review-only task.
```

Example review-only prompt:

```text
Review the current changes from a user-adoption and usability lens.
Review only. Do not edit files. Give findings with file paths and reasoning.
```

Expected behavior:

```text
Copilot calls prepare_context.
Copilot reviews the returned handoff and relevant files.
Copilot reports findings without editing.
```

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

If automatic MCP tools are not available, the developer can copy a prompt-ready
handoff:

```bash
npm run handoff -- --format copilot
```

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
