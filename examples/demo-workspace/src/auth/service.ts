import { saveRefreshToken } from "./token-store";

export function refreshAdminToken(userId: string, currentToken: string) {
  const nextToken = `${userId}:${Date.now()}`;
  saveRefreshToken(userId, nextToken);
  return {
    refreshToken: nextToken,
    revokedToken: currentToken
  };
}

