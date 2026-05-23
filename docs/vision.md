# Vision

AI coding tools are becoming part of the normal software development loop.
The next bottleneck is not only model quality. It is context quality.

Developers already have many sources of truth:

- code
- tests
- specs
- plans
- tasks
- repo instructions
- pull request comments
- issue threads
- chat history
- logs
- diagnostics

Today, AI agents often receive that context as an unstructured pile. Some of
it is useful. Some of it is stale. Some of it is missing. Some of it is
hidden from the user.

Context Delta exists to make context intentional.

## The Core Belief

The right context is usually not the biggest context.

The right context is:

- current
- relevant
- small enough to use well
- rich enough to avoid missing important files
- visible enough for humans to trust

## The Working Set

Context Delta treats context as a versioned working set.

For each task, it asks:

- What changed?
- What is affected?
- Which requirements still apply?
- Which tests prove this behavior?
- Which instructions constrain the implementation?
- Which previous context is now stale?
- What should the agent not see?

The result is a context packet that can be inspected, replayed, measured, and
delivered to an AI coding agent.

## What This Should Feel Like

For most developers, Context Delta should feel invisible until they need it.

The ideal experience:

```text
Ask your agent a normal question.
Context Delta quietly prepares the packet.
The agent works from better context.
You can inspect the packet if something looks wrong.
```

Power users should have control. Casual users should not have to think about
the machinery.

## Long-Term Direction

The long-term goal is to become the context control layer for AI-assisted
software development.

That means:

- local-first context assembly
- transparent packet viewing
- MCP and editor integrations
- spec-to-code traceability
- privacy-safe metrics
- team-level context analytics
- policy and redaction for enterprises

The first version should be simple, useful, and understandable. The deeper
system can grow underneath that promise.

