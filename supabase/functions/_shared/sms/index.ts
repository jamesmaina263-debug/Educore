import type { SmsProvider } from "./types.ts";
import { AfricasTalkingProvider } from "./africasTalkingProvider.ts";
import { ConsoleSmsProvider } from "./consoleProvider.ts";

// Swapping SMS providers later means adding a new class here and
// changing this one factory. Nothing in request-otp/verify-otp
// references Africa's Talking directly — they only depend on
// SmsProvider.
export function getSmsProvider(): SmsProvider {
  const username = Deno.env.get("AT_USERNAME");
  const apiKey = Deno.env.get("AT_API_KEY");
  const senderId = Deno.env.get("AT_SENDER_ID") ?? undefined;

  if (username && apiKey) {
    return new AfricasTalkingProvider(username, apiKey, senderId);
  }

  console.warn(
    "[sms] AT_USERNAME/AT_API_KEY not configured — using ConsoleSmsProvider (dev only, no real SMS sent)",
  );
  return new ConsoleSmsProvider();
}
