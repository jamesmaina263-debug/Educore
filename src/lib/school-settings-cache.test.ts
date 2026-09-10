import { afterEach, describe, expect, it, vi } from "vitest";

// unstable_cache hard-throws ("Invariant: incrementalCache missing") when invoked outside a
// live Next.js request context -- correct behavior in the real deployed app (the framework sets
// that context up per-request), but it means the real implementation can't run in vitest's plain
// Node environment. Mocked here as a passthrough so this test exercises the actual query logic
// (the admin client call, the .eq("id", schoolId) filter, the DEFAULT_SETTINGS fallback)
// without depending on Next's request-scoped cache internals -- the same approach already used
// for @sentry/nextjs in report-server-error.test.ts.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from })),
}));

describe("getCachedSchoolSettings", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the school's settings row, filtered by id", async () => {
    maybeSingle.mockResolvedValue({
      data: { name: "Riverside Academy", expense_approval_threshold: 5000, fee_alert_threshold: 10000 },
    });

    const { getCachedSchoolSettings } = await import("./school-settings-cache");
    const result = await getCachedSchoolSettings("school-123");

    expect(result).toEqual({ name: "Riverside Academy", expense_approval_threshold: 5000, fee_alert_threshold: 10000 });
    expect(from).toHaveBeenCalledWith("schools");
    expect(select).toHaveBeenCalledWith("name, expense_approval_threshold, fee_alert_threshold");
    expect(eq).toHaveBeenCalledWith("id", "school-123");
  });

  it("falls back to defaults when the school row isn't found", async () => {
    maybeSingle.mockResolvedValue({ data: null });

    const { getCachedSchoolSettings } = await import("./school-settings-cache");
    const result = await getCachedSchoolSettings("missing-school");

    expect(result).toEqual({ name: "EduCore", expense_approval_threshold: null, fee_alert_threshold: null });
  });
});
