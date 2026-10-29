// Exercises the send-school-welcome Edge Function handler in Node with a fake Deno global, a fake Supabase client
// that models the atomic "update ... where welcome_email_sent_at is null" claim, and a fake email provider.
// This verifies the function's logic, not Supabase or Resend themselves.
import { describe, it, expect, vi, beforeEach } from "vitest";

type SchoolRow = { id: string; name: string; email: string | null; welcome_email_sent_at: string | null };

const h = vi.hoisted(() => {
  const state = { rows: [] as { id: string; name: string; email: string | null; welcome_email_sent_at: string | null }[], claimError: false };
  const send = vi.fn();
  // Minimal query builder: update(patch).eq(col,val)[.eq|.is]...[.select().maybeSingle()] applied atomically.
  function from() {
    return {
      update(patch: Record<string, unknown>) {
        const filters: [string, "eq" | "is", unknown][] = [];
        const b = {
          eq(col: string, val: unknown) { filters.push([col, "eq", val]); return b; },
          is(col: string, val: unknown) { filters.push([col, "is", val]); return b; },
          select() { return b; },
          then(resolve: (v: unknown) => void) { resolve(run(false)); },
          async maybeSingle() { return run(true); },
        };
        function run(returnRow: boolean) {
          if (state.claimError) return { data: null, error: { code: "XX000" } };
          const hit = state.rows.find((r) =>
            filters.every(([c, op, v]) => (op === "is" ? (r as Record<string, unknown>)[c] === v : (r as Record<string, unknown>)[c] === v)),
          );
          if (!hit) return { data: null, error: null };
          Object.assign(hit, patch);
          return { data: returnRow ? { id: hit.id, name: hit.name, email: hit.email } : null, error: null };
        }
        return b;
      },
    };
  }
  return { state, send, createClient: () => ({ from }) };
});

vi.mock("jsr:@supabase/supabase-js@2.112.4", () => ({ createClient: h.createClient }));
vi.mock("../../supabase/functions/_shared/email/index.ts", () => ({ getEmailProvider: () => ({ send: h.send }) }));

const ID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const env: Record<string, string | undefined> = {};
let handler: (req: Request) => Promise<Response>;

(globalThis as unknown as { Deno: unknown }).Deno = {
  serve: (fn: (req: Request) => Promise<Response>) => { handler = fn; },
  env: { get: (k: string) => env[k] },
};
// Imported through a variable so tsc (which has no Deno types) does not try to type-check the Deno source;
// vitest still loads and runs it, with the mocks above applied.
const FUNCTION_PATH = "../../supabase/functions/send-school-welcome/index.ts";
await import(/* @vite-ignore */ FUNCTION_PATH);

const call = (body: unknown, secret: string | null = "s3cret", method = "POST") =>
  handler(new Request("https://x.test/fn", {
    method,
    headers: { "Content-Type": "application/json", ...(secret ? { "x-dispatch-secret": secret } : {}) },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));

const row = (over: Partial<SchoolRow> = {}): SchoolRow => ({ id: ID, name: "Sunrise Academy", email: "jane@sunrise.ac.ke", welcome_email_sent_at: null, ...over });

describe("send-school-welcome function", () => {
  beforeEach(() => {
    Object.assign(env, { DISPATCH_SECRET: "s3cret", RESEND_API_KEY: "re_x", RESEND_FROM_ADDRESS: "EduCore <hi@educoreafrica.com>", SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" });
    h.state.rows = [row()];
    h.state.claimError = false;
    h.send.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("rejects a missing or wrong secret and a non-POST, without touching the school or the provider", async () => {
    expect((await call({ school_id: ID }, null)).status).toBe(401);
    expect((await call({ school_id: ID }, "nope")).status).toBe(401);
    expect((await call(undefined, "s3cret", "GET")).status).toBe(405);
    env.DISPATCH_SECRET = undefined;
    expect((await call({ school_id: ID }, "anything")).status).toBe(401);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.state.rows[0].welcome_email_sent_at).toBeNull();
  });

  it("validates the school id", async () => {
    expect((await call({})).status).toBe(400);
    expect((await call({ school_id: "not-a-uuid" })).status).toBe(400);
  });

  it("sends to the school's email on file, personalised with its name, and marks it sent", async () => {
    const res = await call({ school_id: ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(h.send).toHaveBeenCalledTimes(1);
    const [to, subject, text, , from, options] = h.send.mock.calls[0];
    expect(to).toBe("jane@sunrise.ac.ke");
    expect(subject).toBe("Welcome to EduCore Africa – We're Here to Support Your School!");
    expect(text).toContain("Dear Sunrise Academy Team,");
    expect(text).toContain("https://wa.me/254702904562");
    expect(from).toBeUndefined();
    expect(options.html).toContain("Dear Sunrise Academy Team,");
    expect(h.state.rows[0].welcome_email_sent_at).not.toBeNull();
  });

  it("never sends a second time: repeat and concurrent calls produce exactly one email", async () => {
    const results = await Promise.all([call({ school_id: ID }), call({ school_id: ID }), call({ school_id: ID })]);
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(bodies.filter((b) => b.sent === true)).toHaveLength(1);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(await (await call({ school_id: ID })).json()).toMatchObject({ sent: false });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("never emails a school that already has the marker set (existing schools / backfill)", async () => {
    h.state.rows = [row({ welcome_email_sent_at: "2026-01-01T00:00:00Z" })];
    expect(await (await call({ school_id: ID })).json()).toMatchObject({ sent: false });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("does nothing for an unknown school", async () => {
    expect(await (await call({ school_id: "11111111-1111-4111-8111-111111111111" })).json()).toMatchObject({ sent: false });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("releases the claim and returns 502 when the provider fails, so a later retry can still send", async () => {
    h.send.mockRejectedValueOnce(new Error("Resend email send failed (500)"));
    const res = await call({ school_id: ID });
    expect(res.status).toBe(502);
    expect(h.state.rows[0].welcome_email_sent_at).toBeNull();
    // The provider error text is logged, not returned to the caller.
    expect(JSON.stringify(await res.json())).not.toMatch(/Resend/);
    expect((await call({ school_id: ID })).status).toBe(200);
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it("does not claim or send when Resend is not configured", async () => {
    env.RESEND_API_KEY = undefined;
    expect((await call({ school_id: ID })).status).toBe(503);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.state.rows[0].welcome_email_sent_at).toBeNull();
  });

  it("releases the claim and sends nothing when the school has no usable email", async () => {
    for (const email of [null, "", "not-an-email"]) {
      h.state.rows = [row({ email })];
      expect((await call({ school_id: ID })).status).toBe(422);
      expect(h.state.rows[0].welcome_email_sent_at).toBeNull();
    }
    expect(h.send).not.toHaveBeenCalled();
  });

  it("returns 500 and sends nothing if the claim itself errors", async () => {
    h.state.claimError = true;
    expect((await call({ school_id: ID })).status).toBe(500);
    expect(h.send).not.toHaveBeenCalled();
  });
});
