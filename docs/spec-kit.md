# Spec Kit Workflows

Context Delta should complement Spec Kit, not compete with it.

Spec Kit helps teams produce structured artifacts for software development,
such as specs, plans, and tasks. Context Delta helps AI coding agents use the
right pieces of those artifacts during implementation.

## Positioning

Spec Kit:

```text
Creates structured intent.
```

Context Delta:

```text
Keeps that intent fresh, scoped, and visible when an AI agent acts.
```

Together:

```text
Spec Kit defines the work.
Context Delta delivers the right working set to the agent.
```

## The Problem In Spec Kit Repos

Spec Kit-style repos can contain multiple feature specs. Over time, teams may
ask:

- Which spec is current?
- Which task file matters for this change?
- Does the code still match the spec?
- Did a later feature supersede an older requirement?
- Should the agent read one spec or several?
- Are we sending too much spec context?

Context Delta should help answer those questions automatically and visibly.

For a Spec Kit-oriented handoff:

```bash
npm run handoff -- --format spec-kit
```

This places spec sections and task evidence before implementation files so
the agent starts from the intended behavior.

## Initial Detection

The engine should look for common spec-driven structures, including:

```text
specs/
  001-feature-name/
    spec.md
    plan.md
    tasks.md

.specify/
.github/
docs/
```

Detection should be flexible. Not every team uses the same folder names.

## Packet Buckets

For Spec Kit workflows, a context packet can group evidence like this:

```text
Intent
Changed spec units
Active implementation files
Impacted tests
Governing constraints
Open questions
Excluded stale specs
```

## Stale Spec Warnings

Context Delta should flag likely drift:

- spec requirement mentions a symbol that no longer exists
- task marked incomplete but code appears implemented
- code changed without nearby spec updates
- two specs describe conflicting behavior
- older spec is semantically similar but not linked to current task

These should be warnings, not hard failures. Developers need help, not a
gatekeeper.

## User Experience

When a developer asks an agent to implement a task, they should see:

```text
Spec Context

Included:
- specs/004-admin-auth/spec.md#refresh-token-rotation
- specs/004-admin-auth/tasks.md#update-token-store

Possible drift:
- specs/001-auth-cleanup/spec.md mentions old refresh-token behavior

Excluded:
- specs/002-marketing-login/spec.md
  Reason: low relevance to admin refresh flow
```

This makes spec-driven work easier to trust because the spec context becomes
visible and debuggable.
