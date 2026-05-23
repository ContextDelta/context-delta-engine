# Example Context Packet

This is an illustrative packet shape. It is not a finalized schema.

## User Task

```text
Add refresh token rotation for admin users.
```

## Packet Summary

```text
Task readiness: Good
Changed files: 2
Related tests: 2
Relevant specs: 1
Rules/instructions: 1
Excluded noisy files: 6
Estimated context reduction: 72%
```

## Packet JSON

```json
{
  "schema_version": "0.1",
  "intent": {
    "summary": "Add refresh token rotation for admin users",
    "confidence": 0.86
  },
  "changed_artifacts": [
    {
      "type": "spec_unit",
      "path": "specs/admin-auth/spec.md",
      "section": "Refresh token rotation",
      "reason": "Requirement changed for admin refresh behavior"
    },
    {
      "type": "file",
      "path": "src/auth/service.ts",
      "reason": "Implements refresh token flow"
    }
  ],
  "impacted_neighbors": [
    {
      "type": "file",
      "path": "src/auth/token-store.ts",
      "reason": "Stores and revokes refresh tokens"
    },
    {
      "type": "test",
      "path": "tests/auth/admin-refresh.test.ts",
      "reason": "Closest behavior test"
    }
  ],
  "governing_constraints": [
    {
      "type": "instruction",
      "path": ".github/copilot-instructions.md",
      "section": "Security",
      "reason": "Token handling rules apply"
    }
  ],
  "excluded": [
    {
      "path": "docs/legacy-oauth.md",
      "reason": "Historical overlap only, no current requirement delta"
    },
    {
      "path": "specs/session-cleanup/spec.md",
      "reason": "Related domain but no direct admin refresh requirement"
    }
  ],
  "metrics": {
    "packet_tokens_estimate": 7800,
    "baseline_tokens_estimate": 28000,
    "tokens_saved_estimate": 20200,
    "context_reduction_percent": 72.1
  }
}
```

## Human-Readable View

```text
Included because it changed:
- specs/admin-auth/spec.md#Refresh token rotation
- src/auth/service.ts

Included because it may be affected:
- src/auth/token-store.ts
- tests/auth/admin-refresh.test.ts

Included because it constrains the work:
- .github/copilot-instructions.md#Security

Excluded:
- docs/legacy-oauth.md
  Reason: historical overlap only
```

