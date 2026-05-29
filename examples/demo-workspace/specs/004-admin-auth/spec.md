# Admin Auth

## Refresh Token Rotation

Admin refresh tokens must rotate after each successful refresh request.

The old refresh token must become invalid immediately after a new token is
issued.

## Acceptance Criteria

- Admin users receive a new refresh token on refresh.
- Reusing the old token fails.
- Token rotation is covered by tests.

