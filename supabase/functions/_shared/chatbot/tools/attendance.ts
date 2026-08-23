import type { ChatContext, ToolDefinition, ToolResult } from "../types.ts";
import { getStudentFirstName } from "../childContext.ts";

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
      return { replyText: `I don't have any attendance records for ${childName} yet.` };
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { count: absences } = await ctx.supabase
      .from("student_attendance")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .eq("status", "absent")
      .gte("attendance_date", thirtyDaysAgo.toISOString().slice(0, 10));

    const statusLabel = latest.status === "present" ? "present" : latest.status === "late" ? "late" : "absent";
    const text =
      `${childName} was marked ${statusLabel} on ${latest.attendance_date}. ` +
      `${absences ?? 0} absence(s) recorded in the last 30 days.`;

    return { replyText: text };
  },
};
