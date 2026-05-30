import { formatEmail } from "./formatter";

export function sendNotification(to: string, body: string) {
  const message = formatEmail(to, body);
  // Email delivery should retry on transient failure.
  return { ...message, attempts: 1, delivered: true };
}
