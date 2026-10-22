import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rpc = vi.fn();
  const client = { rpc };
  return {
    rpc,
    client,
    logAdminAction: vi.fn(),
    revalidatePath: vi.fn(),
    getAdminOperator: vi.fn(),
    createAdminClient: vi.fn(),
    removeSchoolFiles: vi.fn(),
    removeLoginAccounts: vi.fn(),
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {} }));
vi.mock("@/lib/log-admin-action", () => ({ logAdminAction: h.logAdminAction }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/admin-operator-server", () => ({ getAdminOperator: h.getAdminOperator }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.createAdminClient }));
vi.mock("@/lib/admin/purge-school-leftovers", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin/purge-school-leftovers")>()),
  removeSchoolFiles: h.removeSchoolFiles,
  removeLoginAccounts: h.removeLoginAccounts,
}));

const { deleteSchoolPermanently, previewSchoolDeletion } = await import("./actions");

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const input = { schoolId: SCHOOL, confirmSlug: "tetu-academy", reason: "Duplicate trial", eraseBilling: false };
const snapshot = {
  school_name: "Tetu Academy",
  rows_deleted_total: 1234,
  students_deleted: 40,
  staff_deleted: 6,
  auth_user_ids_to_remove: ["u1"],
};

beforeEach(() => {
  for (const m of Object.values(h)) if (typeof m === "function" && "mockReset" in m) (m as ReturnType<typeof vi.fn>).mockReset();
  h.getAdminOperator.mockResolvedValue("James");
  h.createAdminClient.mockReturnValue({});
  h.removeSchoolFiles.mockResolvedValue({ filesRemoved: 3, bucketsChecked: 2, failures: [] });
  h.removeLoginAccounts.mockResolvedValue({ removed: 1, failures: [] });
});

describe("previewSchoolDeletion", () => {
  it("rejects a malformed id without calling the database", async () => {
    expect(await previewSchoolDeletion("x")).toEqual({ error: "Invalid school." });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("returns the preview from the RPC", async () => {
    h.rpc.mockResolvedValue({ data: { slug: "tetu-academy", can_delete: true }, error: null });
    const res = await previewSchoolDeletion(SCHOOL);
    expect(h.rpc).toHaveBeenCalledWith("school_deletion_preview", { p_school_id: SCHOOL });
    expect(res).toEqual({ success: true, preview: { slug: "tetu-academy", can_delete: true } });
  });
});

describe("deleteSchoolPermanently", () => {
  it("validates input before touching anything", async () => {
    expect(await deleteSchoolPermanently({ ...input, schoolId: "x" })).toEqual({ error: "Invalid school." });
    expect(await deleteSchoolPermanently({ ...input, confirmSlug: "  " })).toEqual({ error: "Type the school's slug to confirm." });
    expect(await deleteSchoolPermanently({ ...input, reason: "x" })).toEqual({ error: "Give a short reason for deleting this school." });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("refuses when nobody has identified themselves", async () => {
    h.getAdminOperator.mockResolvedValue(null);
    const res = await deleteSchoolPermanently(input);
    expect("error" in res && res.error).toMatch(/Choose who you are/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("returns the database's refusal and does NO clean-up (nothing was deleted)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "Suspend it first." } });
    expect(await deleteSchoolPermanently(input)).toEqual({ error: "Suspend it first." });
    expect(h.removeSchoolFiles).not.toHaveBeenCalled();
    expect(h.removeLoginAccounts).not.toHaveBeenCalled();
    expect(h.createAdminClient).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("deletes, then removes files and exactly the accounts the database returned", async () => {
    h.rpc.mockResolvedValue({ data: snapshot, error: null });
    const res = await deleteSchoolPermanently({ ...input, eraseBilling: true });
    expect(h.rpc).toHaveBeenCalledWith("delete_school_permanently", {
      p_school_id: SCHOOL,
      p_confirm_slug: "tetu-academy",
      p_reason: "Duplicate trial",
      p_erase_paid_billing: true,
      p_operator: "James",
    });
    expect(h.removeSchoolFiles).toHaveBeenCalledWith(expect.anything(), SCHOOL);
    expect(h.removeLoginAccounts).toHaveBeenCalledWith(expect.anything(), ["u1"]);
    expect(res).toEqual({
      success: true,
      summary: { schoolName: "Tetu Academy", rowsDeleted: 1234, studentsDeleted: 40, staffDeleted: 6, filesRemoved: 3, accountsRemoved: 1, warnings: [] },
    });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("only erases billing when explicitly asked", async () => {
    h.rpc.mockResolvedValue({ data: snapshot, error: null });
    await deleteSchoolPermanently(input);
    expect(h.rpc.mock.calls[0][1].p_erase_paid_billing).toBe(false);
  });

  it("still reports success, with warnings, when file or account clean-up fails", async () => {
    h.rpc.mockResolvedValue({ data: snapshot, error: null });
    h.removeSchoolFiles.mockResolvedValue({ filesRemoved: 1, bucketsChecked: 2, failures: ["docs: boom"] });
    h.removeLoginAccounts.mockResolvedValue({ removed: 0, failures: ["u1: referenced"] });
    const res = await deleteSchoolPermanently(input);
    expect("success" in res && res.summary.warnings).toEqual([
      "Files not fully removed (docs: boom)",
      "Login account not removed (u1: referenced)",
    ]);
    expect(h.logAdminAction).toHaveBeenCalledWith(
      h.client,
      "delete_school_permanently_cleanup",
      expect.objectContaining({ school_id: SCHOOL, warnings: expect.any(Array) }),
    );
  });

  it("still reports success, with a loud warning, when the service-role key is missing", async () => {
    h.rpc.mockResolvedValue({ data: snapshot, error: null });
    h.createAdminClient.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
    });
    const res = await deleteSchoolPermanently(input);
    expect("success" in res && res.summary.warnings[0]).toMatch(/NOT removed: SUPABASE_SERVICE_ROLE_KEY/);
  });
});
