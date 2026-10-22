import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { POST } from "./route";

const KEY = Buffer.from("route-test-signing-key-0123456789");
const SECRET = `whsec_${KEY.toString("base64")}`;

function signed(payload: unknown, opts: { id?: string; secretKey?: Buffer; ts?: string } = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const id = opts.id ?? "msg_abc";
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", opts.secretKey ?? KEY).update(`${id}.${ts}.${body}`).digest("base64");
  return new Request("https://www.educoreafrica.com/api/webhooks/resend", {
    method: "POST",
    headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}`, "content-type": "application/json" },
    body,
  });
}

const bounce = { type: "email.bounced", created_at: "2026-10-21T09:00:00Z", data: { email_id: "e1", from: "hello@educoreafrica.com", to: ["a@b.ke"], subject: "Hi", bounce: { type: "Permanent", message: "no mailbox" } } };

beforeEach(() => {
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  rpc.mockReset();
  rpc.mockResolvedValue({ data: true, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/webhooks/resend", () => {
  it("answers 503 (so Resend retries) when the secret is not configured", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect((await POST(signed(bounce))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a bad signature, a missing signature and a stale timestamp without recording", async () => {
    expect((await POST(signed(bounce, { secretKey: Buffer.from("wrong") }))).status).toBe(401);
    expect((await POST(new Request("https://x/api/webhooks/resend", { method: "POST", body: JSON.stringify(bounce) }))).status).toBe(401);
    expect((await POST(signed(bounce, { ts: "1000000000" }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records a verified bounce with the svix id as the idempotency key", async () => {
    const res = await POST(signed(bounce, { id: "msg_777" }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("record_email_event", {
      p_svix_id: "msg_777",
      p_event_type: "email.bounced",
      p_occurred_at: "2026-10-21T09:00:00.000Z",
      p_email_id: "e1",
      p_from: "hello@educoreafrica.com",
      p_to: "a@b.ke",
      p_subject: "Hi",
      p_bounce_type: "Permanent",
      p_bounce_reason: "no mailbox",
    });
  });

  it("acknowledges but does not record events it does not track, or unreadable bodies", async () => {
    const sent = await POST(signed({ type: "email.sent", data: {} }));
    expect(sent.status).toBe(200);
    expect(await sent.json()).toMatchObject({ ignored: "email.sent" });
    expect((await POST(signed("not json"))).status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records opens and clicks like any other tracked event", async () => {
    for (const type of ["email.opened", "email.clicked"]) {
      rpc.mockClear();
      const res = await POST(signed({ type, created_at: "2026-10-22T10:00:00Z", data: { email_id: "e9", to: ["School@Example.KE"], subject: "Hi" } }, { id: `msg_${type}` }));
      expect(res.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith("record_email_event", expect.objectContaining({ p_svix_id: `msg_${type}`, p_event_type: type, p_to: "School@Example.KE" }));
    }
  });

  it("answers 500 (so Resend retries) when the database call fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await POST(signed(bounce))).status).toBe(500);
    rpc.mockRejectedValue(new Error("network"));
    expect((await POST(signed(bounce))).status).toBe(500);
  });
});
