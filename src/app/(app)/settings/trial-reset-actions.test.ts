import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateClient = vi.fn();
const mockCreateAdminClient = vi.fn();
const mockRemoveFiles = vi.fn();
const mockRemoveLogins = vi.fn();
const mockAlert = vi.fn();
const mockRevalidate = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4" }) }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
vi.mock("@/lib/security-alert", () => ({ sendSecurityAlert: mockAlert }));
vi.mock("@/lib/admin/purge-school-leftovers", () => ({
  removeSchoolFiles: mockRemoveFiles,
  removeLoginAccounts: mockRemoveLogins,
}));

const { getTrialResetPreview, resetTrialSchoolData } = await import("./trial-reset-actions");

const SCHOOL = "Little Hope Academy";
const ALL = ["fees", "academics", "applications", "other", "students", "setup"];

function userClient(
  opts: { user?: unknown; role?: string; reauthError?: boolean; schoolName?: string | null } = {},
) {
  const user = opts.user === undefined ? { id: "u1", email: "owner@school.ke" } : opts.user;
  const signIn = vi.fn().mockResolvedValue({ error: opts.reauthError ? { message: "bad" } : null });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      school_id: "s1",
      roles: { name: opts.role ?? "school_owner" },
      schools: opts.schoolName === null ? null : { name: opts.schoolName ?? SCHOOL },
    },
  });
  const from = vi.fn().mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
  return {
    c: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }), signInWithPassword: signIn }, from },
    signIn,
  };
}

function adminClient(opts: { withinLimit?: boolean | null; limitError?: boolean; resetResult?: unknown } = {}) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "increment_and_check_rate_limit") {
      return { data: opts.withinLimit ?? true, error: opts.limitError ? { message: "x" } : null };
    }
    return opts.resetResult ?? { data: {}, error: null };
  });
  return { c: { rpc }, rpc };
}

const goodInput = { groups: ["fees"], confirmName: SCHOOL, password: "pw" };

beforeEach(() => {
  vi.clearAllMocks();
  mockRemoveFiles.mockResolvedValue({ filesRemoved: 3, bucketsChecked: 1, failures: [] });
  mockRemoveLogins.mockResolvedValue({ removed: 2, failures: [] });
});

describe("resetTrialSchoolData: input checks happen before anything else", () => {
  it.each([
    [{ ...goodInput, groups: ["fees", "nope"] }, "Invalid selection."],
    [{ ...goodInput, groups: "fees" }, "Invalid selection."],
    [{ ...goodInput, groups: [] }, "Tick at least one group of data to remove."],
    [{ ...goodInput, confirmName: "  " }, "Type your school's name to confirm."],
    [{ ...goodInput, password: "" }, "Enter your password to confirm."],
  ])("rejects %j", async (input, message) => {
    expect(await resetTrialSchoolData(input as never)).toEqual({ error: message });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("refuses a selection missing its dependencies instead of guessing", async () => {
    const r = await resetTrialSchoolData({ ...goodInput, groups: ["students"] });
    expect("error" in r && r.error).toMatch(/depends on other data/);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});

describe("resetTrialSchoolData: who may call it", () => {
  it("requires a signed-in user", async () => {
    mockCreateClient.mockResolvedValue(userClient({ user: null }).c);
    expect(await resetTrialSchoolData(goodInput)).toEqual({ error: "Your session has expired. Please sign in again." });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("refuses anyone who is not the school owner, before any limiter, password check or delete", async () => {
    const { c, signIn } = userClient({ role: "principal" });
    mockCreateClient.mockResolvedValue(c);
    expect(await resetTrialSchoolData(goodInput)).toEqual({ error: "Only the school owner can use Start fresh." });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("a wrong school name stops everything and does not use up a rate-limit attempt", async () => {
    const { c, signIn } = userClient();
    mockCreateClient.mockResolvedValue(c);
    const r = await resetTrialSchoolData({ ...goodInput, confirmName: "Some Other School" });
    expect(r).toEqual({ error: "The school name you typed does not match. Nothing was deleted." });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe("resetTrialSchoolData: rate limit and password", () => {
  it("stops when the rate limit is exceeded, without checking the password or deleting", async () => {
    const { c, signIn } = userClient();
    const a = adminClient({ withinLimit: false });
    mockCreateClient.mockResolvedValue(c);
    mockCreateAdminClient.mockReturnValue(a.c);
    expect(await resetTrialSchoolData(goodInput)).toEqual({ error: "Too many attempts. Please wait a while and try again." });
    expect(signIn).not.toHaveBeenCalled();
    expect(a.rpc).not.toHaveBeenCalledWith("reset_trial_school_data", expect.anything());
    expect(mockAlert).toHaveBeenCalled();
  });

  it("fails closed when the limiter itself errors", async () => {
    const { c, signIn } = userClient();
    const a = adminClient({ limitError: true });
    mockCreateClient.mockResolvedValue(c);
    mockCreateAdminClient.mockReturnValue(a.c);
    const r = await resetTrialSchoolData(goodInput);
    expect("error" in r).toBe(true);
    expect(signIn).not.toHaveBeenCalled();
    expect(a.rpc).not.toHaveBeenCalledWith("reset_trial_school_data", expect.anything());
  });

  it("rejects a wrong password and never calls the delete function", async () => {
    const { c } = userClient({ reauthError: true });
    const a = adminClient();
    mockCreateClient.mockResolvedValue(c);
    mockCreateAdminClient.mockReturnValue(a.c);
    expect(await resetTrialSchoolData(goodInput)).toEqual({ error: "Password is incorrect." });
    expect(a.rpc).not.toHaveBeenCalledWith("reset_trial_school_data", expect.anything());
    expect(mockRemoveFiles).not.toHaveBeenCalled();
  });
});

describe("resetTrialSchoolData: the wipe", () => {
  it("calls the database function with the verified user and chosen groups, then cleans up only matching buckets", async () => {
    const { c } = userClient();
    const a = adminClient({
      resetResult: {
        data: { rows_total: 12, rows_by_group: { fees: 12 }, parents_kept_still_referenced: 0, auth_user_ids_to_remove: ["p1"] },
        error: null,
      },
    });
    mockCreateClient.mockResolvedValue(c);
    mockCreateAdminClient.mockReturnValue(a.c);

    const r = await resetTrialSchoolData({ groups: ["applications"], confirmName: SCHOOL, password: "pw" });
    expect(a.rpc).toHaveBeenCalledWith("reset_trial_school_data", {
      p_school_id: "s1",
      p_actor: "u1",
      p_groups: ["applications"],
      p_confirm_name: SCHOOL,
      p_dry_run: false,
    });
    // Only the application documents folder -- never logos, staff documents or the admission form template.
    expect(mockRemoveFiles).toHaveBeenCalledWith(a.c, "s1", ["application-documents"]);
    expect(mockRemoveLogins).toHaveBeenCalledWith(a.c, ["p1"]);
    expect(r).toMatchObject({ success: true, summary: { rowsRemoved: 12, filesRemoved: 3, loginsRemoved: 2, warnings: [] } });
    expect(mockRevalidate).toHaveBeenCalled();
  });

  it("everything ticked still never targets protected buckets", async () => {
    const { c } = userClient();
    mockCreateClient.mockResolvedValue(c);
    mockCreateAdminClient.mockReturnValue(adminClient().c);
    await resetTrialSchoolData({ groups: ALL, confirmName: SCHOOL, password: "pw" });
    const buckets = mockRemoveFiles.mock.calls[0][2] as string[];
    for (const protectedBucket of ["admission-form-templates", "school-logos", "staff-documents"]) {
      expect(buckets).not.toContain(protectedBucket);
    }
  });

  it("surfaces a database refusal as a friendly message and does no cleanup", async () => {
    const { c } = userClient();
    const a = adminClient({
      resetResult: { data: null, error: { message: "Data can only be reset while the school is on a free trial." } },
    });
    mockCreateClient.mockResolvedValue(c);
    mockCreateAdminClient.mockReturnValue(a.c);
    expect(await resetTrialSchoolData(goodInput)).toEqual({
      error: "Start fresh is only available while your school is on its free trial.",
    });
    expect(mockRemoveFiles).not.toHaveBeenCalled();
    expect(mockRemoveLogins).not.toHaveBeenCalled();
  });

  it("hides raw database detail behind a generic message", async () => {
    const { c } = userClient();
    const a = adminClient({ resetResult: { data: null, error: { message: 'violates foreign key constraint "x_fkey" on table "y"' } } });
    mockCreateClient.mockResolvedValue(c);
    mockCreateAdminClient.mockReturnValue(a.c);
    const r = await resetTrialSchoolData(goodInput);
    expect("error" in r && r.error).not.toMatch(/x_fkey/);
  });

  it("reports a failed file cleanup as a warning but still reports success (the data is already gone)", async () => {
    const { c } = userClient();
    mockCreateClient.mockResolvedValue(c);
    mockCreateAdminClient.mockReturnValue(adminClient().c);
    mockRemoveFiles.mockRejectedValue(new Error("storage down"));
    const r = await resetTrialSchoolData(goodInput);
    expect(r).toMatchObject({ success: true });
    expect("summary" in r && r.summary.warnings.join(" ")).toMatch(/storage down/);
  });
});

describe("getTrialResetPreview", () => {
  it("returns per-group counts using a dry run that deletes nothing", async () => {
    const { c } = userClient();
    const a = adminClient({
      resetResult: { data: { rows_by_group: { fees: 5, students: 9 } }, error: null },
    });
    mockCreateClient.mockResolvedValue(c);
    mockCreateAdminClient.mockReturnValue(a.c);
    const r = await getTrialResetPreview();
    expect(a.rpc).toHaveBeenCalledWith("reset_trial_school_data", expect.objectContaining({ p_dry_run: true, p_groups: [] }));
    expect(r).toEqual({
      eligible: true,
      schoolName: SCHOOL,
      counts: { fees: 5, academics: 0, applications: 0, other: 0, students: 9, setup: 0 },
    });
  });

  it("explains why a paying school cannot use it", async () => {
    const { c } = userClient();
    mockCreateClient.mockResolvedValue(c);
    mockCreateAdminClient.mockReturnValue(
      adminClient({ resetResult: { data: null, error: { message: "Data can only be reset while the school is on a free trial." } } }).c,
    );
    expect(await getTrialResetPreview()).toEqual({
      eligible: false,
      reason: "Start fresh is only available while your school is on its free trial.",
    });
  });

  it("is not available to non-owners", async () => {
    mockCreateClient.mockResolvedValue(userClient({ role: "teacher" }).c);
    expect(await getTrialResetPreview()).toEqual({ eligible: false, reason: "Only the school owner can use Start fresh." });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});
