import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SVIX_TOLERANCE_SECONDS, TRACKED_EVENT_TYPES, parseResendEvent, verifySvixSignature } from "./resend-webhook";

const KEY = Buffer.from("super-secret-signing-key-0123456789");
const SECRET = `whsec_${KEY.toString("base64")}`;
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const TS = String(Math.floor(NOW / 1000));
const BODY = JSON.stringify({ type: "email.delivered", data: { email_id: "e1" } });
const sign = (id: string, ts: string, body: string, key = KEY) => `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
const base = { id: "msg_1", timestamp: TS, body: BODY, secret: SECRET, nowMs: NOW };

describe("verifySvixSignature", () => {
  it("accepts a correctly signed body", () => {
    expect(verifySvixSignature({ ...base, signature: sign("msg_1", TS, BODY) })).toBe(true);
  });
  it("accepts when one of several signatures matches", () => {
    expect(verifySvixSignature({ ...base, signature: `v1,AAAA ${sign("msg_1", TS, BODY)}` })).toBe(true);
  });
  it("rejects a changed body, id, wrong secret and unknown version", () => {
    const sig = sign("msg_1", TS, BODY);
    expect(verifySvixSignature({ ...base, body: BODY + " ", signature: sig })).toBe(false);
    expect(verifySvixSignature({ ...base, id: "msg_2", signature: sig })).toBe(false);
    expect(verifySvixSignature({ ...base, secret: `whsec_${Buffer.from("other").toString("base64")}`, signature: sig })).toBe(false);
    expect(verifySvixSignature({ ...base, signature: sig.replace("v1,", "v2,") })).toBe(false);
  });
  it("rejects stale and future timestamps beyond the tolerance, accepts within it", () => {
    const old = String(Math.floor(NOW / 1000) - SVIX_TOLERANCE_SECONDS - 1);
    expect(verifySvixSignature({ ...base, timestamp: old, signature: sign("msg_1", old, BODY) })).toBe(false);
    const future = String(Math.floor(NOW / 1000) + SVIX_TOLERANCE_SECONDS + 1);
    expect(verifySvixSignature({ ...base, timestamp: future, signature: sign("msg_1", future, BODY) })).toBe(false);
    const ok = String(Math.floor(NOW / 1000) - SVIX_TOLERANCE_SECONDS + 5);
    expect(verifySvixSignature({ ...base, timestamp: ok, signature: sign("msg_1", ok, BODY) })).toBe(true);
  });
  it("rejects missing pieces and a garbage timestamp without throwing", () => {
    const sig = sign("msg_1", TS, BODY);
    expect(verifySvixSignature({ ...base, id: null, signature: sig })).toBe(false);
    expect(verifySvixSignature({ ...base, timestamp: null, signature: sig })).toBe(false);
    expect(verifySvixSignature({ ...base, signature: null })).toBe(false);
    expect(verifySvixSignature({ ...base, secret: "", signature: sig })).toBe(false);
    expect(verifySvixSignature({ ...base, timestamp: "abc", signature: sig })).toBe(false);
    expect(verifySvixSignature({ ...base, signature: "v1," })).toBe(false);
  });
});

describe("parseResendEvent", () => {
  it("maps a bounce", () => {
    const e = parseResendEvent({
      type: "email.bounced",
      created_at: "2026-10-21T09:00:00.000Z",
      data: { email_id: "e9", from: "EduCore <hello@educoreafrica.com>", to: ["Head@school.ke"], subject: "Hi", bounce: { type: "Permanent", subType: "General", message: "mailbox does not exist" } },
    })!;
    expect(e).toMatchObject({ eventType: "email.bounced", emailId: "e9", to: "Head@school.ke", subject: "Hi", bounceType: "Permanent / General", bounceReason: "mailbox does not exist", occurredAt: "2026-10-21T09:00:00.000Z" });
  });
  it("accepts a string recipient, falls back to data.created_at, and tolerates missing parts", () => {
    const e = parseResendEvent({ type: "email.delivered", data: { to: "a@b.ke", created_at: "2026-10-20T01:02:03Z" } })!;
    expect(e).toMatchObject({ to: "a@b.ke", occurredAt: "2026-10-20T01:02:03.000Z", bounceType: null, bounceReason: null, emailId: null });
    const bare = parseResendEvent({ type: "email.failed" })!;
    expect(bare.to).toBeNull();
    expect(Number.isNaN(Date.parse(bare.occurredAt))).toBe(false);
  });
  it("returns null for non-events and truncates long text", () => {
    expect(parseResendEvent(null)).toBeNull();
    expect(parseResendEvent([])).toBeNull();
    expect(parseResendEvent({ data: {} })).toBeNull();
    expect(parseResendEvent({ type: "email.delivered", data: { subject: "x".repeat(900) } })!.subject).toHaveLength(300);
  });
  it("tracks only the five delivery outcomes", () => {
    expect([...TRACKED_EVENT_TYPES].sort()).toEqual(["email.bounced", "email.complained", "email.delivered", "email.delivery_delayed", "email.failed"]);
    expect(TRACKED_EVENT_TYPES.has("email.opened")).toBe(false);
  });
});
