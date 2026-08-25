// Verifies that an inbound request actually came from Twilio, per Twilio's request-validation
// algorithm: https://www.twilio.com/docs/usage/webhooks/webhooks-security
//
// Without this, whatsapp-webhook is a public, unauthenticated endpoint (it has to be -- Twilio
// can't send a Supabase JWT) that inserts messages and triggers automated replies purely from an
// HTTP POST. Anyone who found the URL could inject fake "guardian" messages into any school's
// inbox. The signature ties every request to Twilio's TWILIO_AUTH_TOKEN, which only Twilio and
// this deployment know.
//
// Algorithm: HMAC-SHA1(authToken, url + sorted(key+value for every POST param)), base64-encoded,
// compared against the X-Twilio-Signature header.
import { timingSafeEqual } from "../timingSafeEqual.ts";

export async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string | null,
  authToken: string,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const computed = base64Encode(new Uint8Array(signatureBytes));

  return timingSafeEqual(computed, signatureHeader);
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}


