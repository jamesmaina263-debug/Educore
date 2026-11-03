// Web push helpers (WP 8.3). Pure functions, no browser or server APIs, so the page, the server sender and
// the tests share one definition. The push-only service worker (public/push-sw.js) re-applies the same
// URL rule on the device, because the device must not trust what arrives.

export const PUSH_FLAG = "feature.pwa.web_push";

export const MAX_TITLE = 80;
export const MAX_BODY = 200;
export const MAX_PAYLOAD_BYTES = 3000; // push services accept ~4 KB; stay well below

/**
 * Only same-origin paths are allowed as a notification's click target. Anything else (another site,
 * a protocol-relative "//host", a "javascript:" URL, a backslash trick) falls back to "/".
 */
export function safeNotificationUrl(url: unknown): string {
  if (typeof url !== "string") return "/";
  const u = url.trim();
  if (u.length === 0 || u.length > 300) return "/";
  if (!u.startsWith("/") || u.startsWith("//") || u.includes("\\")) return "/";
  if (/[\u0000-\u001f]/.test(u)) return "/";
  return u;
}

export interface PushMessage {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

export function buildPushPayload(msg: PushMessage): { error: string } | { payload: string } {
  const title = (msg.title ?? "").trim();
  if (title.length === 0) return { error: "A notification needs a title." };
  const body = (msg.body ?? "").trim();
  const tag = (msg.tag ?? "").trim();
  const payload = JSON.stringify({
    title: title.slice(0, MAX_TITLE),
    body: body.slice(0, MAX_BODY),
    url: safeNotificationUrl(msg.url),
    ...(tag ? { tag: tag.slice(0, 60) } : {}),
  });
  if (new TextEncoder().encode(payload).length > MAX_PAYLOAD_BYTES) return { error: "The notification is too large." };
  return { payload };
}

export type PushOutcome = "ok" | "dead" | "retry" | "failed";

/** What a push service's HTTP status means for that subscription. */
export function classifyPushStatus(status: number): PushOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 410) return "dead"; // subscription is gone: stop using it
  if (status === 429 || status >= 500) return "retry";
  return "failed";
}

/** Decode the base64url VAPID public key into the bytes `pushManager.subscribe` expects. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** A VAPID public key is an uncompressed P-256 point: 65 bytes, i.e. 87 base64url characters. */
export function looksLikeVapidPublicKey(key: string | undefined | null): key is string {
  return typeof key === "string" && /^[A-Za-z0-9_-]{87}$/.test(key);
}
