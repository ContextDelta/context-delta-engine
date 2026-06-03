export function auditTrailEntry(actor: string, action: string) {
  return `${actor}:${action}:${Date.now()}`;
}
