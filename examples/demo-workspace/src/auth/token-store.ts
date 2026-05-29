const refreshTokens = new Map<string, string>();

export function saveRefreshToken(userId: string, token: string) {
  refreshTokens.set(userId, token);
}

export function getRefreshToken(userId: string) {
  return refreshTokens.get(userId);
}

