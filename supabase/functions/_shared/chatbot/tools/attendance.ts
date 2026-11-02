import type { ChatContext, ToolDefinition, ToolResult } from "../types.ts";
import { getStudentFirstName } from "../childContext.ts";
import { attendanceText, noAttendanceText } from "../menu.ts";

export const attendanceTool: ToolDefinition = {
  key: "attendance",
  async run(ctx: ChatContext, studentId: string): Promise<ToolResult> {
    const childName = await getStudentFirstName(ctx.supabase, studentId);

    const { data: latest } = await ctx.supabase
      .from("student_attendance")
      .select("attendance_date, status")
      .eq("student_id", studentId)
      .order("attendance_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) {
      return { replyText: noAttendanceText(ctx.language ?? "en", childName) };
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { count: absences } = await ctx.supabase
      .from("student_attendance")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .eq("status", "absent")
      .gte("attendance_date", thirtyDaysAgo.toISOString().slice(0, 10));

    const text = attendanceText(ctx.language ?? "en", {
      name: childName,
      status: latest.status,
      date: latest.attendance_date,
      absences: absences ?? 0,
    });

    return { replyText: text };
  },
};
