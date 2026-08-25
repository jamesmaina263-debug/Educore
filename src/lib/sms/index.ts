import type { SmsProvider } from "./types";
import { AfricasTalkingProvider } from "./africasTalkingProvider";
import { ConsoleSmsProvider } from "./consoleProvider";

// Duplicate of supabase/functions/_shared/sms/index.ts, ported to run on
// Vercel/Node instead of Deno.
//
// Why duplicated instead of shared: the ZKTeco terminal is hardcoded to
// call /iclock/cdata with no configurable path prefix, which is why that
// route has to live as a Next.js Route Handler on Vercel rather than a
// Supabase Edge Function (see src/app/iclock/cdata/route.ts's header
// comment). Edge Functions run on Deno; this runs on Node. Neither
// runtime's module resolution can import the other's files without a
// shared-package build step this repo doesn't have, so this is a genuine
// second copy of the provider -- not a shortcut.
//
// Consequence: AT_USERNAME / AT_API_KEY / AT_SENDER_ID must be set in BOTH
// places -- Supabase Edge Function secrets (already set, per
// SECRETS_ROTATION_POLICY.md) AND Vercel project env vars (not yet set --
// see .env.local.example). They're currently sandbox credentials
// (AT_USERNAME=sandbox), which only deliver to Africa's Talking's Sandbox
// Simulator, not real phones -- same caveat applies here as it does to the
// kiosk path. If the credentials are ever rotated, both places need the
// update or one send path silently reverts to ConsoleSmsProvider (which
// itself now fails loudly rather than silently, see devFallbackGuard.ts --
// but "fails loudly" still means guardian SMS stop going out from
// whichever path got missed).
export function getSmsProvider(): SmsProvider {
  const username = process.env.AT_USERNAME;
  const apiKey = process.env.AT_API_KEY;
  const senderId = process.env.AT_SENDER_ID || undefined;

  if (username && apiKey) {
    return new AfricasTalkingProvider(username, apiKey, senderId);
  }

  console.warn("[sms] AT_USERNAME/AT_API_KEY not configured — using ConsoleSmsProvider (dev only, no real SMS sent)");
  return new ConsoleSmsProvider();
}
