# Research Notes

These are working notes for the product direction. They are not a substitute
for formal citations or benchmarks.

## Observations

AI coding tools increasingly support large contexts, memory, instructions,
rules, prompt files, hooks, and MCP integrations.

That does not fully solve the context problem.

The failure mode shifts from:

```text
The agent does not have enough context.
```

to:

```text
The agent has too much, too little, stale, or hidden context.
```

## Product Gap

Existing tools are strong in adjacent areas:

- broad codebase search
- IDE-native assistant workflows
- persistent memory
- spec generation
- PR review
- agent orchestration

The gap Context Delta targets:

```text
Per-task context packets that are delta-aware, cross-agent, local-first,
and visible to the user.
```

## Differentiation

The differentiator should remain crisp:

- delta-aware packet building
- cross-host portability through MCP and editor integrations
- literal packet visibility
- spec-driven development support
- privacy-safe metrics

If the product becomes only "better search," it will be harder to
differentiate. The packet viewer and delta model are the product center.

## Validation Questions

The project should validate:

- Do developers understand the problem quickly?
- Do packets reduce repeated context explanation?
- Do packets include the tests/specs users expect?
- Do users trust the viewer?
- How often do users override packets?
- Does context reduction preserve or improve output quality?
- Are managers interested in aggregate context metrics?

## Early Targets

Initial targets should be conservative:

- 40% to 60% estimated input context reduction
- no increase in missed-context corrections
- packet override rate below 15% of sessions
- at least one quality or speed win in real workflows

These are product goals, not external claims.

