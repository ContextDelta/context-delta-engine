# Observability

Context Delta should make context quality visible without collecting raw code
or prompt text by default.

The local prototype writes observability files under:

```text
.contextdelta/
  packets/
    latest.json
    latest-diff.json
  reports/
    session-metrics.jsonl
    events.jsonl
    latest.html
    weekly-summary.md
    weekly-summary.json
```

These files are ignored by git by default.

## Packet JSON

`latest.json` contains the latest packet:

- intent
- changed artifacts
- supporting evidence
- governing constraints
- impacted neighbors
- excluded context
- warnings
- metrics
- redaction summary
- insight headline, risk level, and recommendations
- compact content-free preview

## Metrics JSONL

`session-metrics.jsonl` contains privacy-safe summary events:

- estimated packet tokens
- estimated baseline tokens
- estimated tokens saved
- included file counts
- included spec/test counts
- packet risk level
- budget pressure and target tokens
- warning counts
- redaction counts
- stale spec warnings

## Events JSONL

`events.jsonl` is for operational events:

- packet written
- report generated
- manager summary written
- future packet expansion
- future policy warning

## HTML Report

Generate a local report:

```bash
npm run packet -- "Fix auth" --report
```

Or from the latest packet:

```bash
npm run report
```

The report shows:

- packet insight and recommended next steps
- packet summary
- estimated savings
- redaction count
- warnings
- included context and reasons
- excluded context and reasons
- metrics summary

## Manager Summary

Generate repo-level local summary files:

```bash
npm run summary
```

The summary shows:

- sessions
- estimated tokens saved
- average packet size
- average context reduction
- risk mix
- budget pressure mix
- stale spec warnings
- redaction count

## Privacy Position

By default, observability is local. Team and org aggregation should use
privacy-safe records and avoid raw source code or raw prompts unless users
explicitly opt in.
