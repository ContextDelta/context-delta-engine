# Example Manager Metrics Summary

This is an illustrative report for engineering leaders that shows the *format*
of a future multi-repo rollup. Every number below is a placeholder, not
measured deployment data — Context Delta does not ship invented totals. The
only figures it claims today come from the reproducible packet-quality eval
(`npm run eval:multi`): 3/3 gold-set cases passing, 96% average useful-context
density, 100% impact coverage, and 68% average whole-workspace reduction.
Reports use estimated, privacy-safe metrics and should never include raw
source code or prompt text.

## Weekly Summary

```text
Context Delta Weekly Report

Repos measured: 12
Active developers: 48
AI-assisted sessions: 1,284

Estimated input tokens saved: 42.3M
Average context reduction: 61%
Average packet size: 7,400 tokens
Packets accepted without edits: 84%
Manual override rate: 11%
Packet expansion rate: 7%
Low-risk packets: 78%
Over-budget packets: 6%
Secret-like values redacted: 43

Spec-driven signals:
- spec sections included: 936
- stale spec warnings: 19
- conflicting spec warnings: 4

Quality signals:
- related tests included: 1,102
- repeated context lookups avoided: 31
- missing-context corrections: 27
```

## What It Means

```text
The team is getting smaller, more focused AI context packets while preserving
developer control. Spec-driven workflows are active, and stale spec warnings
show where requirements may need cleanup.
```

## What To Investigate

```text
Repos with high manual override rates may need better spec structure,
instruction cleanup, or test discovery rules.
```
