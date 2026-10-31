import { describe, expect, it, vi } from "vitest";
import { notifyReportCardEvent } from "./report-card-notify";

describe("notifyReportCardEvent", () => {
  it("calls the database function with exactly the scope given", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    await notifyReportCardEvent({ rpc } as never, { event: "awaiting_approval", examId: "e1", streamId: "s1" });
    expect(rpc).toHaveBeenCalledWith("notify_report_card_event", { p_event: "awaiting_approval", p_exam_id: "e1", p_class_id: null, p_stream_id: "s1", p_student_id: null });
  });

  it("never lets a notification problem escape (rejection or error result)", async () => {
    await expect(notifyReportCardEvent({ rpc: vi.fn().mockRejectedValue(new Error("down")) } as never, { event: "approved", examId: "e1", studentId: "st" })).resolves.toBeUndefined();
    await expect(notifyReportCardEvent({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "nope" } }) } as never, { event: "approved", examId: "e1", classId: "c" })).resolves.toBeUndefined();
  });
});
