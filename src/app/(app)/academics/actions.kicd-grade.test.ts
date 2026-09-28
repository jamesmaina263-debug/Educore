import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/observability/sentry-context", () => ({ setSentryRequestContext: vi.fn(), tagSentryRequestContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateClassKicdGrade } = await import("./actions");

function clientReturning(result: unknown) {
  const update = vi.fn();
  const chain: Record<string, unknown> = {};
  chain.update = (...a: unknown[]) => (update(...a), chain);
  chain.eq = () => chain;
  chain.select = () => Promise.resolve(result);
  return { client: { from: () => chain }, update };
}

describe("updateClassKicdGrade", () => {
  beforeEach(() => mockCreateClient.mockClear());

  it("rejects an unknown grade without touching the database", async () => {
    expect(await updateClassKicdGrade("c1", "G13")).toEqual({ error: "Please choose a valid grade." });
    expect(await updateClassKicdGrade("c1", "Grade 6")).toEqual({ error: "Please choose a valid grade." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("rejects a missing class id", async () => {
    expect(await updateClassKicdGrade("", "G6")).toEqual({ error: "Missing class." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("saves a valid grade", async () => {
    const { client, update } = clientReturning({ data: [{ id: "c1" }], error: null });
    mockCreateClient.mockResolvedValue(client);
    expect(await updateClassKicdGrade("c1", "G6")).toEqual({ success: true });
    expect(update).toHaveBeenCalledWith({ kicd_grade: "G6" });
  });

  it("clears the grade with null", async () => {
    const { client, update } = clientReturning({ data: [{ id: "c1" }], error: null });
    mockCreateClient.mockResolvedValue(client);
    expect(await updateClassKicdGrade("c1", null)).toEqual({ success: true });
    expect(update).toHaveBeenCalledWith({ kicd_grade: null });
  });

  it("reports a permission error when RLS silently updates nothing", async () => {
    const { client } = clientReturning({ data: [], error: null });
    mockCreateClient.mockResolvedValue(client);
    expect(await updateClassKicdGrade("c1", "G6")).toEqual({
      error: "You don't have permission to change this class, or it no longer exists.",
    });
  });
});
