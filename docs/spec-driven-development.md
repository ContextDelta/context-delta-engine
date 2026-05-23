# Spec-Driven Development

Spec-driven development gives AI-assisted work a stronger foundation.

Instead of asking an agent to "just build something," teams define:

- requirements
- acceptance criteria
- constraints
- implementation plans
- tasks
- validation steps

This helps AI tools work from intent rather than vibes.

## The New Problem

As spec-driven development scales, teams get a new context problem:

- specs accumulate over time
- old requirements may conflict with new ones
- plans can drift from implementation
- tasks can be completed but still referenced
- code becomes the practical source of truth again
- agents may read too much or too little spec context

The issue is not whether specs are useful. They are useful. The issue is that
AI agents need the right parts of the right specs at the right moment.

## Where Context Delta Fits

Spec-driven development answers:

```text
What should be built?
```

Context Delta answers:

```text
Which parts of the spec, code, tests, docs, and history matter right now?
```

The engine should parse specs into smaller units:

- goals
- user stories
- requirements
- acceptance criteria
- constraints
- non-goals
- tasks
- open questions

Then, for a coding task, it can include only the relevant units instead of
dumping the whole spec directory into the prompt.

## Example

Task:

```text
Add refresh token rotation for admin users.
```

Relevant spec context:

- requirement about admin refresh behavior
- security constraint around token reuse
- acceptance criterion for revocation
- task that mentions migration or token store changes

Likely stale or lower-priority context:

- old OAuth migration notes
- previous non-admin session cleanup spec
- broad architecture doc with no changed requirement

The packet should show both sides:

```text
Included:
- specs/admin-auth/spec.md#refresh-token-rotation
- specs/admin-auth/tasks.md#token-store-migration

Excluded:
- specs/legacy-oauth.md
  Reason: historical overlap only, no current requirement delta
```

## Key Product Features

For spec-driven development, Context Delta should support:

- spec folder detection
- markdown heading parsing
- requirement unit extraction
- changed requirement detection
- spec-to-code trace view
- stale spec warnings
- implementation coverage hints
- task completion context
- prompt packet preview

## Success Criteria

Context Delta is working for spec-driven teams when:

- agents use current requirements more consistently
- stale specs are visible instead of silently included
- implementation tasks include nearby tests and constraints
- developers can see why a spec section was included
- managers can see how often specs are driving agent work

