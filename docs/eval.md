# Packet-Quality Eval

Context Delta should earn correctness claims with labeled tasks, not broad
claims about being "better context."

The eval harness scores a generated packet against a gold set that names the
minimum sufficient context for a task.

## Run The Demo Eval

```bash
npm run eval -- --workspace examples/demo-workspace --cases ../eval/gold-set.json
```

Run the multi-shape gate used by release checks:

```bash
npm run eval:multi
```

Outputs are written locally:

```text
.contextdelta/eval/latest-eval.json
.contextdelta/eval/latest-eval.md
```

Use `--json` for automation:

```bash
npm run eval -- --workspace examples/demo-workspace --cases ../eval/gold-set.json --json
```

## Gold-Set Shape

```json
{
  "cases": [
    {
      "id": "auth-refresh-rotation",
      "workspace": "../demo-workspace",
      "task": "Add refresh token rotation for admin users",
      "minimum_context": {
        "paths": [
          "specs/004-admin-auth/spec.md",
          "src/auth/service.ts",
          "tests/auth/admin-refresh.test.ts"
        ],
        "acceptable_paths": [
          "specs/004-admin-auth/tasks.md"
        ]
      },
      "forbidden_paths": [
        "docs/legacy-oauth.md"
      ],
      "pass": {
        "min_impact_coverage": 0.8,
        "min_useful_context_density": 0.45,
        "max_omission_rate": 0.2,
        "max_forbidden": 0
      }
    }
  ]
}
```

`workspace` is optional. When present, it is resolved relative to the gold-set
file, which lets one suite cover several small repo shapes without relying on
the current checkout's local edits.

## Metrics

- **Impact coverage:** required paths included divided by required paths.
- **Omission rate:** required paths missed divided by required paths.
- **Useful-context density:** required or acceptable paths divided by all
  included paths.
- **Forbidden included:** paths that should not have been in the packet.
- **Packet size:** estimated packet tokens.

Use token reduction as a cost signal. Use eval scores as the quality signal.

Release checks run the multi-shape eval with `--fail-on-failure` so ranking and
preset changes have to preserve labeled packet quality instead of only passing
unit tests that mirror the implementation.

## Why This Matters

The public claim should be:

```text
Context Delta makes context visible, replayable, and measurable.
```

After enough labeled tasks, the project can make narrower, defensible claims
about packet quality by language, repo shape, or workflow.
