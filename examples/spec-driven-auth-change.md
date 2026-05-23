# Spec-Driven Auth Change Example

This example shows how Context Delta could support a spec-driven development
workflow.

## Scenario

A team uses specs to define authentication behavior. A developer asks an AI
agent:

```text
Implement admin refresh token rotation from the current spec.
```

## Without Context Delta

The agent may receive:

- the whole auth spec directory
- old OAuth notes
- unrelated session cleanup docs
- long chat history
- the active file only
- no related test

The agent may miss:

- the current admin-specific requirement
- the token-store migration task
- the security instruction
- the closest regression test

## With Context Delta

The engine prepares:

```text
Intent:
- Implement admin refresh token rotation

Spec:
- specs/004-admin-auth/spec.md#Refresh token rotation
- specs/004-admin-auth/tasks.md#Update token store

Code:
- src/auth/service.ts
- src/auth/token-store.ts

Tests:
- tests/auth/admin-refresh.test.ts
- tests/auth/session-revocation.test.ts

Rules:
- .github/copilot-instructions.md#Security

Warnings:
- specs/001-auth-cleanup/spec.md mentions older refresh behavior

Excluded:
- docs/legacy-oauth.md
  Reason: old migration note, low current relevance
```

## Why This Helps

The agent sees the working set that matters now instead of a pile of
possibly relevant files.

The developer can also inspect the packet and catch mistakes before the
agent acts.

