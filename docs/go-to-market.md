# Go To Market

Context Delta should be marketed as a practical context layer, not as another
AI coding assistant.

The wedge:

```text
Better context for the AI coding tools you already use.
```

## Target Audiences

### Individual Developers

Pain:

- AI misses files
- repeated re-explaining
- stale chat context
- unclear what the agent used

Message:

```text
Keep your AI tool. Give it cleaner context.
```

### Senior Engineers

Pain:

- agents miss blast radius
- specs drift from code
- tests are skipped
- architecture rules are buried

Message:

```text
Make the agent work from the current implementation context, not a pile of
old files.
```

### Spec-Driven Teams

Pain:

- specs accumulate
- old requirements conflict with new ones
- agents read the wrong section
- implementation and specs drift

Message:

```text
Spec-driven development creates intent. Context Delta keeps that intent
fresh at implementation time.
```

### Engineering Leaders

Pain:

- AI usage is hard to measure
- token spend is opaque
- productivity gains are anecdotal
- governance teams want visibility

Message:

```text
Measure context savings and AI workflow friction without collecting raw
source code.
```

## Position Against Existing Tools

Do not attack existing tools. Context Delta should ride alongside them.

```text
Copilot, Claude Code, Cursor, and VS Code are where developers work.
Context Delta prepares the context they work from.
```

Spec Kit positioning:

```text
Spec Kit helps define the work.
Context Delta helps agents use the right spec context while doing the work.
```

## Launch Narrative

The launch story should be:

```text
AI coding agents are only as good as their context.
Today that context is noisy, stale, incomplete, and hidden.
Context Delta creates a visible context packet for every AI coding task.
```

## Best Demo

Use one tight workflow:

```text
1. Open a repo with a spec and tests.
2. Make or select a task.
3. Context Delta shows changed files, related tests, relevant spec section,
   and excluded stale docs.
4. Show estimated token reduction.
5. Send packet to an agent.
```

The demo should take under two minutes.

## Marketing Assets

Needed later:

- one screenshot of the packet viewer
- one before/after context example
- one Spec Kit workflow example
- one Copilot workflow example
- one manager metrics report
- one architecture diagram
- one "why not just use longer context?" explanation

## Pricing Direction

Keep open source useful.

Possible future pricing:

- Free: local-only, single user, open-source core
- Pro: hosted sync, advanced analytics, convenience features
- Team: governance, audit logs, repo summaries, admin controls
- Enterprise: on-prem, air-gapped, compliance, SSO, support

The paid product should not be "pay to make context work." It should be
"pay for team control, visibility, and scale."

## What To Avoid

- sounding like generic RAG
- overusing deep architecture language on the homepage
- claiming exact productivity gains before evidence exists
- forcing users into a new IDE
- making Spec Kit sound like a competitor
- exporting sensitive metrics by default

