# Sample Copilot Handoff

This is a shortened example of what `context-delta handoff --format copilot`
produces.

````markdown
# Context Delta Handoff For GitHub Copilot

Task: Add refresh token rotation for admin users
Packet ID: packet-demo
Insight: Packet is ready for spec-driven AI coding.
Risk: low
Budget pressure: low
Estimated packet tokens: 7800
Estimated tokens saved: 9200
Context reduction: 54%

## Copilot Instructions

- Prefer the changed artifacts, specs, tests, and repo instructions in this packet over broad repository guessing.
- Keep edits scoped to the task and nearby affected files.
- If a required file is absent, ask for expansion instead of inventing hidden context.
- Respect any security or style constraints listed below.

## Repo Instructions And Rules

### .github/copilot-instructions.md#Security

Reason: Instruction file section that may constrain the agent
Type: instruction_section

```text
Token changes must include tests and avoid logging secrets.
```

## Changed Files

### src/auth/service.ts

Reason: Changed according to git status
Type: git_diff

## Specs And Behavior Evidence

### specs/004-admin-auth/spec.md#Refresh Token Rotation

Reason: Spec section matched the task and may define intent
Type: spec_section
````
