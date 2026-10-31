import { beforeEach, describe, expect, it, vi } from "vitest";

// notification_logs is queried twice by getMyInAppNotifications: the capped list, then the exact unread count.
const h = vi.hoisted(() => ({
  list: [] as Record<string, unknown>[],
  unread: 0 as number | null,
  filters: [] as { kind: string; calls: string[] }[],
}));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "auth-1" } } }) },
    from(table: string) {
      const calls: string[] = [];
      let head = false;
      const b: Record<string, unknown> = {
        select: (_cols: string, opts?: { head?: boolean }) => ((head = !!opts?.head), b),
        eq: (k: string, v: unknown) => (calls.push(`eq:${k}=${v}`), b),
        is: (k: string, v: unknown) => (calls.push(`is:${k}=${v}`), b),
        order: () => b,
        limit: () => b,
        maybeSingle: async () => ({ data: { id: "su-1" }, error: null }),
        then: (resolve: (r: unknown) => unknown) => {
          if (table === "notification_logs") h.filters.push({ kind: head ? "count" : "list", calls });
          return Promise.resolve(head ? { count: h.unread, data: null, error: null } : { data: h.list, error: null }).then(resolve);
        },
      };
      return b;
    },
  }),
}));

const { getMyInAppNotifications } = await import("./actions");

beforeEach(() => {
  h.list = [];
  h.unread = 0;
  h.filters = [];
});

describe("getMyInAppNotifications: unread count", () => {
  it("returns the exact unread total even when it exceeds the 20-row list", async () => {
    h.list = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, body: "b", subject: "s", created_at: "2026-10-31T00:00:00Z", read_at: null, action_url: null }));
    h.unread = 37;
    const res = await getMyInAppNotifications();
    expect(res).toMatchObject({ success: true, unread_count: 37 });
    expect("notifications" in res && res.notifications).toHaveLength(20);
  });

  it("counts only the caller's own, undismissed, unread in-app notifications", async () => {
    h.unread = 3;
    await getMyInAppNotifications();
    const count = h.filters.find((f) => f.kind === "count");
    expect(count?.calls).toEqual(expect.arrayContaining(["eq:channel=in_app", "eq:recipient_school_user_id=su-1", "is:dismissed_at=null", "is:read_at=null"]));
  });

  it("falls back to counting the list if the count query returns nothing", async () => {
    h.list = [
      { id: "a", body: "b", subject: null, created_at: "x", read_at: null, action_url: null },
      { id: "b", body: "b", subject: null, created_at: "x", read_at: "2026-10-31", action_url: null },
    ];
    h.unread = null;
    expect(await getMyInAppNotifications()).toMatchObject({ unread_count: 1 });
  });
});
