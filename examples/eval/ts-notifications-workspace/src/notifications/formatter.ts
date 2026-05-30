export function formatEmail(to: string, body: string) {
  return { to, body: body.trim(), kind: "email" };
}
