// Mirrors supabase/functions/_shared/sms/types.ts exactly. Kept as an
// intentional duplicate, not a shared import -- Edge Functions run on Deno
// and this runs on Vercel/Node, so the two runtimes can't share a module
// without a build-tooling change neither side currently has. See
// src/lib/sms/index.ts for the fuller rationale and the drift risk this
// creates.
export interface SmsProvider {
  send(phone: string, message: string): Promise<void>;
}
