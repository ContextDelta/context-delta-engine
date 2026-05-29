# Before And After Context Example

This is a demo-friendly way to explain Context Delta.

## Before

```text
User asks:
Add refresh token rotation for admin users.

Agent context:
- entire auth folder
- unrelated legacy OAuth docs
- old chat history
- random open files
- no clear current spec section
- no visible token budget
- no explanation of what was excluded
```

Typical result:

```text
The agent changes the service but misses the token-store behavior and does
not update the admin refresh test.
```

## After

```text
User asks:
Add refresh token rotation for admin users.

Context Delta packet:
- changed auth service
- token store neighbor
- Refresh Token Rotation spec section
- Acceptance Criteria section
- admin refresh test
- Copilot security instruction
- excluded legacy docs with reasons
- risk level: low
- budget pressure: low
```

Typical result:

```text
The agent sees the requirement, nearby implementation, relevant test, and
security instruction in one inspectable packet before editing.
```

## Demo Line

```text
Context Delta does not make the model smarter. It makes the working set
cleaner, fresher, and visible.
```
