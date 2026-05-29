import { refreshAdminToken } from "../../src/auth/service";
import { getRefreshToken } from "../../src/auth/token-store";

test("rotates admin refresh token", () => {
  const result = refreshAdminToken("admin-1", "old-token");
  expect(result.refreshToken).not.toBe("old-token");
  expect(getRefreshToken("admin-1")).toBe(result.refreshToken);
});

