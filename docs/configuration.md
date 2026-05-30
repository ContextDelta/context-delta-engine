# Configuration

Context Delta can run with zero configuration, but repos can add a
`contextdelta.config.json` file when they want policy controls, pinned
context, exclusions, or stricter packet behavior.

Create a default config:

```bash
npm run init
```

Force overwrite:

```bash
npm run init -- --force
```

See [contextdelta.config.example.json](../contextdelta.config.example.json)
for a complete example.

## Modes

```json
{
  "mode": "balanced"
}
```

Supported modes:

- `balanced`: default packet size and recall
- `conservative`: includes more context to reduce omission risk
- `strict`: smaller packets and policy-first behavior

## Token model

Token counts use a real tokenizer (`gpt-tokenizer`) when available, falling
back to a fast heuristic otherwise. Set the target model so counts match the
agent you actually use:

```json
{
  "targetModel": "gpt-4o"
}
```

The default (`null`) uses `o200k_base` (the GPT-4o / GPT-4.1 / o-series / GPT-5
family), which is also the safe proxy for non-OpenAI or unknown models. Classic
`gpt-4` / `gpt-3.5` map to `cl100k_base`. Override per run with the CLI
`--model` flag or the `model` argument on the `prepare_context` MCP tool. Run
`npm run doctor` to confirm whether the exact tokenizer is active.

## Budget

Packet budget is advisory. Context Delta estimates packet tokens and marks
budget pressure as `low`, `medium`, `high`, or `over`.

```json
{
  "limits": {
    "targetTokens": 12000
  }
}
```

CLI override:

```bash
npm run packet -- "Fix auth" --target-tokens 8000
```

## Pinning

Pinned files are included even when ranking would not choose them.

```json
{
  "controls": {
    "pin": [
      "docs/spec-driven-development.md",
      "specs/current-feature/spec.md"
    ]
  }
}
```

Use this for:

- core architecture docs
- current feature specs
- repo-specific instructions
- critical tests

## Exclusions

Excluded files are omitted from packets.

```json
{
  "controls": {
    "exclude": [
      "docs/legacy/",
      "*.local.md"
    ]
  }
}
```

Policy exclusions are stronger defaults for sensitive or generated content:

```json
{
  "policy": {
    "excludePaths": [
      ".env",
      "*.pem",
      "secrets/"
    ]
  }
}
```

## Redaction

Context Delta redacts common secret-like values by default before packet
content is written.

Custom redaction rules can be added:

```json
{
  "policy": {
    "redactionPatterns": [
      {
        "name": "internal_ticket",
        "pattern": "TICKET-[0-9]+"
      }
    ]
  }
}
```

Redaction counts appear in packet security metadata and HTML reports.

## CLI Overrides

Temporary controls can be applied from the CLI:

```bash
npm run packet -- "Fix auth" --mode conservative --pin docs/auth.md --exclude docs/legacy/
```

These overrides apply to that command run.
