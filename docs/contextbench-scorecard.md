# ContextBench Scorecard

_Reproduce: `npm run contextbench`. This file is generated; do not edit by hand._

## Aggregate

| Metric | Result |
| --- | --- |
| Cases | 8 |
| Passed | 8 / 8 (100%) |
| Impact coverage (avg) | 100% |
| Omission rate (avg) | 0% |
| Useful-context density (avg) | 95.5% |
| Whole-workspace reduction (avg) | 82.5% |
| Avg packet size | 2413 tokens |

## Per case

| Case | Shape | Status | Coverage | Omission | Density | Forbidden |
| --- | --- | --- | --- | --- | --- | --- |
| auth-refresh-rotation-demo | TypeScript · auth | pass | 100% | 0% | 94.1% | 0 |
| static-site-responsive-review | HTML/CSS/JS · static site | pass | 100% | 0% | 100% | 0 |
| node-service-validation | JavaScript · service | pass | 100% | 0% | 100% | 0 |
| python-payments-validation | Python · service | pass | 100% | 0% | 90% | 0 |
| ts-notifications-retry | TypeScript · barrel re-export | pass | 100% | 0% | 100% | 0 |
| go-billing-validation | Go · module-aware | pass | 100% | 0% | 100% | 0 |
| ts-inventory-reorder-precision | TypeScript · precision (decoys) | pass | 100% | 0% | 90% | 0 |
| rust-billing-validation | Rust · mod/use crate | pass | 100% | 0% | 90% | 0 |

## What the metrics mean

- **Impact coverage** — required files included ÷ required files. Did the right context get in?
- **Omission rate** — required files missed ÷ required files. The failure mode that breaks tasks.
- **Useful-context density** — required-or-acceptable files ÷ all included files. Signal vs noise.
- **Forbidden** — stale/irrelevant files that leaked in. Should be zero.
- **Reduction** — secondary cost signal, not the headline.
