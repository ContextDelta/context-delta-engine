# ContextBench

**A public, reproducible benchmark for the question every context engine dodges:
did the packet contain the *right* things — not just *fewer* things?**

Most tools report a single number: token reduction. That measures how *small* the
context is, not whether it was *correct*. A packet can be 90% smaller and still
drop the one file the task needed. ContextBench measures correctness directly,
against labeled tasks, so "better context" is earned rather than asserted.

## Why this exists

- Token-reduction percentages are unfalsifiable marketing — they have no ground
  truth. ContextBench has ground truth: each task names the minimum sufficient
  context.
- It is the one asset a competitor cannot clone by shipping a feature: a labeled
  corpus + a definition of correctness + reproducible scores that compound as the
  corpus grows.
- It lets *anyone* — including other engines — measure themselves the same way.

## The metrics

For each labeled task, a generated packet is scored against the task's
`minimum_context` (required and acceptable paths) and `forbidden_paths`:

- **Impact coverage** — required paths included ÷ required paths. *Did the right
  context get in?*
- **Omission rate** — required paths missed ÷ required paths. *The failure mode
  that actually breaks tasks.*
- **Useful-context density** — required-or-acceptable paths ÷ all included paths.
  *Signal vs. noise — this is where "smaller" and "correct" are traded honestly.*
- **Forbidden inclusions** — stale or irrelevant files that leaked in. *Should be
  zero.*
- **Whole-workspace reduction** — reported as a secondary cost signal only, never
  the headline.

A case passes only if it clears per-case thresholds on all four quality metrics.

## Run it

```bash
npm run contextbench            # prints the scorecard
npm run contextbench -- --write # also regenerates docs/contextbench-scorecard.md
```

The current results live in
[contextbench-scorecard.md](contextbench-scorecard.md) and are reproducible from
a clean checkout. The same cases gate every release via `npm run eval:multi`, so
a ranking change that regresses correctness fails CI — not just unit tests.

## The gold set

The bundled set (`examples/eval/multi-shape-gold-set.json`) spans TypeScript
(auth, and a re-export barrel), JavaScript, Python, Go, Rust, a static site, and
a precision case seeded with decoy modules — verifying quality across languages
and repo shapes. Each case is a small, self-contained workspace so the suite does
not depend on the current checkout's local edits.

## Contribute a case (grow the moat)

ContextBench gets stronger with every labeled task. To add one:

1. Add a small, self-contained workspace under `examples/eval/<your-case>-workspace/`
   (source + tests + a spec/doc + an instruction file, and a stale/archive file
   that should be excluded).
2. Add a case to `examples/eval/multi-shape-gold-set.json`:

   ```json
   {
     "id": "your-case-id",
     "workspace": "your-case-workspace",
     "task": "A realistic one-line task",
     "exclude": ["docs/archive/"],
     "minimum_context": {
       "paths": ["src/thing.ts", "tests/thing.test.ts"],
       "acceptable_paths": ["specs/thing/spec.md", "AGENTS.md"]
     },
     "forbidden_paths": ["docs/archive/legacy.md"],
     "pass": { "min_impact_coverage": 1, "min_useful_context_density": 0.4, "max_omission_rate": 0, "max_forbidden": 0 }
   }
   ```

3. Run `npm run contextbench -- --write` and confirm it passes, then open a PR.

The aim is breadth and honest difficulty — real failure modes (stale specs,
deep transitive impact, tempting decoys), not easy wins.

## What ContextBench is not

It does not (yet) measure end-to-end *task success* — whether an agent given the
packet actually completes the task. That A/B harness is the planned next layer;
path-level correctness is the foundation it builds on.
