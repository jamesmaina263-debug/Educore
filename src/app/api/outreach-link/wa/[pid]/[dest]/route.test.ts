import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (fn: () => Promise<void>) => afterCallbacks.push(fn) };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { GET, HEAD } from "./route";

const PID = "20000000-0000-4000-8000-000000000002";
const UA = "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

function req(headers: Record<string, string> = { "user-agent": UA }, method = "GET") {
  return new Request("https://www.educoreafrica.com/api/outreach-link/wa/x/y", { method, headers }) as unknown as Parameters<typeof GET>[0];
}
function ctx(pid: string, dest: string) {
  return { params: Promise.resolve({ pid, dest }) };
}
async function run(r: Parameters<typeof GET>[0], pid: string, dest: string) {
  const res = await GET(r, ctx(pid, dest));
  await Promise.all(afterCallbacks.splice(0).map((f) => f()));
  return res;
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: true, error: null });
  afterCallbacks.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/outreach-link/wa/[pid]/[dest]", () => {
  it("records the click and redirects to the page with the same UTM tags as the untracked WhatsApp link", async () => {
    const res = await run(req(), PID, "signup");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://www.educoreafrica.com/signup?utm_source=outreach&utm_medium=whatsapp&utm_campaign=school_outreach&utm_content=signup",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(rpc).toHaveBeenCalledWith("record_outreach_whatsapp_click", { p_prospect_id: PID, p_destination: "signup", p_is_probable_bot: false });
  });

  it("maps contact to its page", async () => {
    const res = await run(req(), PID, "contact");
    expect(res.headers.get("location")).toBe(
      "https://www.educoreafrica.com/contact?utm_source=outreach&utm_medium=whatsapp&utm_campaign=school_outreach&utm_content=contact",
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("flags WhatsApp's own link-preview fetch, other bots and a missing user agent as probable bots", async () => {
    for (const ua of ["WhatsApp/2.23.20.0 A", "WhatsApp/2.24.1.6 i", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Googlebot/2.1", ""]) {
      rpc.mockClear();
      await run(req(ua ? { "user-agent": ua } : {}), PID, "signup");
      expect(rpc).toHaveBeenCalledWith("record_outreach_whatsapp_click", expect.objectContaining({ p_is_probable_bot: true }));
    }
  });

  it("treats a normal phone browser as a person", async () => {
    await run(req({ "user-agent": UA }), PID, "signup");
    expect(rpc).toHaveBeenCalledWith("record_outreach_whatsapp_click", expect.objectContaining({ p_is_probable_bot: false }));
  });

  it("redirects home and records nothing for a malformed id or unknown destination (no open redirect)", async () => {
    for (const [pid, dest] of [["not-a-uuid", "signup"], [PID, "https://evil.example"], [PID, "admin"], [PID, "Signup"]] as const) {
      const res = await run(req(), pid, dest);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://www.educoreafrica.com/");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records nothing for a staff browser marked as internal, but still redirects", async () => {
    const res = await run(req({ "user-agent": UA, cookie: "ec_internal=1" }), PID, "contact");
    expect(res.status).toBe(302);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still redirects when recording fails or throws", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await run(req(), PID, "signup")).status).toBe(302);
    rpc.mockRejectedValueOnce(new Error("network"));
    expect((await run(req(), PID, "signup")).status).toBe(302);
  });
});

describe("HEAD /api/outreach-link/wa/[pid]/[dest]", () => {
  it("redirects but never records", async () => {
    const res = await HEAD(req({ "user-agent": UA }, "HEAD"), ctx(PID, "signup"));
    await Promise.all(afterCallbacks.splice(0).map((f) => f()));
    expect(res.status).toBe(302);
    expect(rpc).not.toHaveBeenCalled();
  });
});
