# Overnight Build Plan

## North Star

Use your agent normally. Context Delta prepares the right working set quietly,
shows `Context ready · risk=...`, and only asks for attention when the packet
is risky, stale, too large, or missing obvious tests/specs.

The dashboard is the audit trail. It should not be the main workflow.

## What This Build Prioritizes

1. MCP first path: one `prepare_context` tool that returns a handoff, not raw
   packet JSON by default.
2. CLI first path: `context-delta prepare` for the same risk-header plus
   handoff flow outside MCP.
3. VS Code quiet path: status bar readiness, one-click prepare-and-copy
   actions, warning fix buttons, and collapsed advanced controls.
4. General presets: code review, docs/content review, test/debug,
   spec-driven change, and security-sensitive work. No repo-specific presets.
5. Eval gate: ranking and preset changes must pass a labeled multi-shape
   suite, not just unit tests that mirror implementation details.
6. Honest messaging: token savings are a cost signal; eval scores are the
   quality signal.

## Deferred On Purpose

- Broad mid-loop interception for every agent host. That needs host hooks; a
  file-watcher can summarize drift after a run, but cannot reliably intercept
  every internal agent step.
- Heavy file-picker-first UX. Advanced include/exclude remains available, but
  the default should be automatic and low-friction.
- Repo-specific magic such as hardcoded GitHub Pages presets. Those make demos
  look good and real adoption worse.

## Acceptance Criteria

- `prepare_context` is the primary MCP tool and returns a risk header plus
  prompt-ready handoff.
- `npm run prepare -- "task"` works without requiring a separate handoff step.
- `npm run doctor -- --mcp` prints setup guidance.
- VS Code defaults to prepare-and-copy, with advanced controls collapsed.
- `npm run eval:multi` passes across auth, static site, and service/test
  fixture shapes.
- `npm run release:check` stays green.
