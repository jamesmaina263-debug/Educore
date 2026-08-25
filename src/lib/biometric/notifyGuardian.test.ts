import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.AT_USERNAME = "sandbox";
  process.env.AT_API_KEY = "test-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.resetModules();
});

// Minimal fake of the subset of the supabase-js query builder this module
// actually calls: .from(table).select(...).eq(...)... is awaitable
// directly (thenable) OR terminated with .single()/.maybeSingle(), and
// .insert(...)/.update(...) behave the same way. `tableData` maps a table
// name to the { data } (or { data, error }) it should resolve to,
// regardless of which chain reached it -- enough to drive this module's
// logic without reimplementing a real query planner.
function buildFakeAdmin(tableData: Record<string, unknown>) {
  const insertCalls: Array<{ table: string; row: Record<string, unknown> }> = [];
  const updateCalls: Array<{ table: string; patch: Record<string, unknown> }> = [];

  function makeBuilder(table: string) {
    const result = tableData[table] ?? { data: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      insert: (row: Record<string, unknown>) => {
        insertCalls.push({ table, row });
        return builder;
      },
      update: (patch: Record<string, unknown>) => {
        updateCalls.push({ table, patch });
        return builder;
      },
      single: async () => result,
      maybeSingle: async () => result,
      then: (resolve: (v: unknown) => void) => resolve(result),
    };
    return builder;
  }

  const admin = { from: (table: string) => makeBuilder(table) };
  return { admin, insertCalls, updateCalls };
}

describe("notifyGuardianOfGateEvent", () => {
  it("returns skipped and sends nothing when no guardian has a phone on file", async () => {
    const { admin } = buildFakeAdmin({
      students: { data: { first_name: "Amina", last_name: "Otieno" } },
      schools: { data: { name: "Riverside Academy" } },
      student_guardians: { data: [{ guardian_user_id: "g1", guardian: { id: "g1", phone: null } }] },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { notifyGuardianOfGateEvent } = await import("./notifyGuardian");
    const result = await notifyGuardianOfGateEvent(admin as never, {
      schoolId: "school-1",
      studentId: "student-1",
      eventType: "check_in",
      occurredAt: new Date("2026-08-25T06:05:00Z"),
    });

    expect(result).toEqual({ status: "skipped", logId: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends via Africa's Talking and marks the log 'sent' on success", async () => {
    const { admin, insertCalls, updateCalls } = buildFakeAdmin({
      students: { data: { first_name: "Amina", last_name: "Otieno" } },
      schools: { data: { name: "Riverside Academy" } },
      student_guardians: { data: [{ guardian_user_id: "g1", guardian: { id: "g1", phone: "+254700000000" } }] },
      communication_templates: { data: [] },
      notification_preferences: { data: null },
      notification_logs: { data: { id: "log-1" } },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ SMSMessageData: { Recipients: [{ status: "Success", number: "+254700000000" }] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { notifyGuardianOfGateEvent } = await import("./notifyGuardian");
    const result = await notifyGuardianOfGateEvent(admin as never, {
      schoolId: "school-1",
      studentId: "student-1",
      eventType: "check_in",
      occurredAt: new Date("2026-08-25T06:05:00Z"),
    });

    expect(result).toEqual({ status: "sent", logId: "log-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(insertCalls[0].table).toBe("notification_logs");
    expect((insertCalls[0].row.body as string)).toContain("Amina Otieno");
    expect(updateCalls.at(-1)).toEqual({ table: "notification_logs", patch: expect.objectContaining({ status: "sent" }) });
  });

  it("marks the log 'failed' -- and does not throw -- when the SMS provider rejects", async () => {
    const { admin, updateCalls } = buildFakeAdmin({
      students: { data: { first_name: "Amina", last_name: "Otieno" } },
      schools: { data: { name: "Riverside Academy" } },
      student_guardians: { data: [{ guardian_user_id: "g1", guardian: { id: "g1", phone: "+254700000000" } }] },
      communication_templates: { data: [] },
      notification_preferences: { data: null },
      notification_logs: { data: { id: "log-1" } },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, text: async () => "insufficient balance" }));

    const { notifyGuardianOfGateEvent } = await import("./notifyGuardian");
    const result = await notifyGuardianOfGateEvent(admin as never, {
      schoolId: "school-1",
      studentId: "student-1",
      eventType: "check_out",
      occurredAt: new Date("2026-08-25T15:05:00Z"),
    });

    expect(result.status).toBe("failed");
    expect(updateCalls.at(-1)).toEqual({ table: "notification_logs", patch: expect.objectContaining({ status: "failed" }) });
  });

  it("skips a guardian who opted out via notification_preferences without sending", async () => {
    const { admin } = buildFakeAdmin({
      students: { data: { first_name: "Amina", last_name: "Otieno" } },
      schools: { data: { name: "Riverside Academy" } },
      student_guardians: { data: [{ guardian_user_id: "g1", guardian: { id: "g1", phone: "+254700000000" } }] },
      notification_preferences: { data: { enabled: false } },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { notifyGuardianOfGateEvent } = await import("./notifyGuardian");
    const result = await notifyGuardianOfGateEvent(admin as never, {
      schoolId: "school-1",
      studentId: "student-1",
      eventType: "check_in",
      occurredAt: new Date("2026-08-25T06:05:00Z"),
    });

    expect(result).toEqual({ status: "skipped", logId: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
