import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (fn: () => Promise<void>) => afterCallbacks.push(fn) };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { GET, HEAD } from "./route";

const RID = "10000000-0000-4000-8000-000000000001";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120";

function req(headers: Record<string, string> = { "user-agent": UA }, method = "GET") {
  return new Request("https://www.educoreafrica.com/api/outreach-link/x/y", { method, headers }) as unknown as Parameters<typeof GET>[0];
}
function ctx(rid: string, dest: string) {
  return { params: Promise.resolve({ rid, dest }) };
}
async function run(r: Parameters<typeof GET>[0], rid: string, dest: string) {
  const res = await GET(r, ctx(rid, dest));
  await Promise.all(afterCallbacks.splice(0).map((f) => f()));
  return res;
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: true, error: null });
  afterCallbacks.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/outreach-link/[rid]/[dest]", () => {
  it("records the click and redirects to the same page with the same UTM tags as the untracked link", async () => {
    const res = await run(req(), RID, "signup");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://www.educoreafrica.com/signup?utm_source=outreach&utm_medium=email&utm_campaign=school_outreach&utm_content=signup",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(rpc).toHaveBeenCalledWith("record_outreach_click", { p_recipient_id: RID, p_destination: "signup", p_is_probable_bot: false });
  });

  it.each([
    ["home", "https://www.educoreafrica.com/?utm_source=outreach&utm_medium=email&utm_campaign=school_outreach&utm_content=home"],
    ["contact", "https://www.educoreafrica.com/contact?utm_source=outreach&utm_medium=email&utm_campaign=school_outreach&utm_content=contact"],
    ["brochure", "https://www.educoreafrica.com/brochure?utm_source=outreach&utm_medium=email&utm_campaign=school_outreach&utm_content=brochure"],
  ])("maps %s to its page", async (dest, location) => {
    const res = await run(req(), RID, dest);
    expect(res.headers.get("location")).toBe(location);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("flags an automated user agent as a probable bot instead of dropping it", async () => {
    await run(req({ "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }), RID, "signup");
    expect(rpc).toHaveBeenCalledWith("record_outreach_click", expect.objectContaining({ p_is_probable_bot: true }));
    rpc.mockClear();
    await run(req({}), RID, "signup");
    expect(rpc).toHaveBeenCalledWith("record_outreach_click", expect.objectContaining({ p_is_probable_bot: true }));
  });

  it("redirects home and records nothing for a malformed id or an unknown destination (no open redirect)", async () => {
    for (const [rid, dest] of [["not-a-uuid", "signup"], [RID, "https://evil.example"], [RID, "admin"], [RID, "Signup"]] as const) {
      const res = await run(req(), rid, dest);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://www.educoreafrica.com/");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records nothing for a staff browser marked as internal, but still redirects", async () => {
    const res = await run(req({ "user-agent": UA, cookie: "ec_internal=1" }), RID, "contact");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/contact?");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still redirects when recording fails or throws", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await run(req(), RID, "signup")).status).toBe(302);
    rpc.mockRejectedValueOnce(new Error("network"));
    expect((await run(req(), RID, "signup")).status).toBe(302);
  });
});

describe("HEAD /api/outreach-link/[rid]/[dest]", () => {
  it("redirects but never records", async () => {
    const res = await HEAD(req({ "user-agent": UA }, "HEAD"), ctx(RID, "signup"));
    await Promise.all(afterCallbacks.splice(0).map((f) => f()));
    expect(res.status).toBe(302);
    expect(rpc).not.toHaveBeenCalled();
  });
});
