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

// Plain === on the computed vs. provided signature would leak timing information about how many
// leading characters matched -- irrelevant against Twilio itself, but this function's contract is
// "safely compare two signatures," not "safely compare two signatures, except when the input
// happens to come from Twilio," so it's constant-time regardless of caller.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
