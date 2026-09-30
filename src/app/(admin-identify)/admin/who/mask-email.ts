// Pure helper, kept in its own file (no "use client"/"use server") so it can be unit-tested
// without pulling in operator-picker.tsx's imports (which chain into otp-actions.ts -> the
// server-only admin client, which throws if imported outside a server context).
//
// Masks everything but the first char and the domain, e.g. "james.maina@educoreafrica.com" ->
// "j***@educoreafrica.com" -- enough for someone to recognise their own address, not enough to
// hand a shoulder-surfer the full thing off the shared screen.
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local[0]}***@${domain}`;
}
