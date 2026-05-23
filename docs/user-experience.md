# User Experience

Context Delta should feel easy because it fits into the way developers
already work.

The user should not have to become a prompt engineer, context librarian, or
tool integrator. The product should prepare context quietly, then make it
visible when the user wants to inspect it.

## UX Principle

```text
Quiet by default. Inspectable on demand.
```

Some developers want full control. Others want the tool to stay out of the
way. Context Delta should support both.

## First-Run Experience

After installation, the user sees:

```text
Context Delta found your workspace.

Detected:
- Git repository
- GitHub Copilot instructions
- Specs/docs
- Tests
- MCP-compatible environment

Mode: Local only
Status: Indexing workspace
```

If git is missing:

```text
Git not detected.

Context Delta will use local snapshots, recent file saves, active files,
docs, specs, tests, and instructions.
```

The user should not have to configure much to get value.

## Main Panel

The default panel should be simple:

```text
Current Context Packet

Task readiness: Good
Changed files: 3
Related tests: 2
Relevant specs: 1
Rules/instructions: 2
Excluded noisy files: 18
Estimated context reduction: 64%
```

The panel should have three obvious actions:

```text
Inspect Packet
Expand Context
Send To Agent
```

Power-user controls can exist, but they should not dominate the first view.

## Packet Viewer

The packet viewer is the signature feature.

It should show:

- exact packet preview
- included files and snippets
- reasons for inclusion
- excluded files and reasons
- changed vs unchanged indicators
- stale spec warnings
- token estimate
- estimated savings
- pin, exclude, expand, compact controls

The viewer should answer the user's real question:

```text
What is my AI agent about to see, and why?
```

## Seamless Agent Flow

The ideal flow:

```text
1. Developer asks the agent a normal question.
2. Context Delta prepares the packet in the background.
3. Agent receives focused context through the available integration.
4. Developer can inspect the packet if the answer looks wrong.
```

The developer should not need to copy files around manually in the normal
case.

## Modes

### Quiet Mode

Best for users who want no extra workflow.

Behavior:

- background indexing
- automatic packet preparation
- minimal notifications
- inspect only on demand

### Inspect Mode

Best for users debugging agent behavior.

Behavior:

- packet preview before send
- visible reasons
- visible exclusions
- manual pin/exclude controls
- packet replay

### Conservative Mode

Best for users who distrust pruning.

Behavior:

- broader packets
- lower token savings
- fewer omission risks
- more related tests/docs included

### Strict Mode

Best for privacy-sensitive or enterprise workflows.

Behavior:

- tighter exclusions
- policy enforcement
- redaction
- explicit approval before packet delivery

## Visual Language

The product should visualize context as a packet, not as a search result.

Useful visual sections:

```text
Intent
Changed
Impacted
Specs
Rules
Tests
Excluded
Metrics
```

Each item should have a reason:

```text
Included because this file changed.
Included because this test covers the changed behavior.
Included because this spec section contains a current requirement.
Excluded because this doc appears historical.
```

## What Success Feels Like

For a developer:

```text
I can keep using Copilot or Claude Code, but now I can see and control the
context.
```

For a senior engineer:

```text
The agent stopped missing the related tests and stale specs are visible.
```

For a manager:

```text
We can see context savings and friction across repos without collecting raw
source code.
```

