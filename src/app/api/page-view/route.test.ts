import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn().mockResolvedValue({ error: null });
const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (fn: () => Promise<void>) => afterCallbacks.push(fn) };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { POST } from "./route";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120";
function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://educoreafrica.com/api/page-view", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "user-agent": UA, host: "educoreafrica.com", "x-forwarded-for": "41.90.1.1", "x-vercel-ip-country": "KE", ...headers },
  }) as unknown as Parameters<typeof POST>[0];
}
async function run(r: Parameters<typeof POST>[0]) {
  const res = await POST(r);
  await Promise.all(afterCallbacks.splice(0).map((f) => f()));
  return res;
}

beforeEach(() => rpc.mockClear());

describe("POST /api/page-view", () => {
  it("records a valid view and answers 204", async () => {
    const res = await run(req({ path: "/pricing", isEntry: true, click: "google" }));
    expect(res.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("record_page_view", expect.objectContaining({ p_path: "/pricing", p_country: "KE", p_device: "desktop", p_click_platform: "google", p_is_entry: true }));
  });
  it("records nothing for a browser marked as internal, and still records one with other cookies", async () => {
    expect((await run(req({ path: "/pricing" }, { cookie: "ec_internal=1" }))).status).toBe(204);
    expect(rpc).not.toHaveBeenCalled();
    await run(req({ path: "/pricing" }, { cookie: "theme=dark; other=1" }));
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("silently drops bots, cross-site, malformed and internal paths", async () => {
    for (const r of [
      req({ path: "/" }, { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }),
      req({ path: "/" }, { "sec-fetch-site": "cross-site" }),
      req("not json"),
      req({ path: "/admin" }),
    ]) {
      expect((await run(r)).status).toBe(204);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
