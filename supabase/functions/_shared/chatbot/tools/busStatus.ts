import type { ChatContext, ToolDefinition, ToolResult } from "../types.ts";
import { getStudentFirstName } from "../childContext.ts";
import { answerBusQuestion } from "../bus.ts";

// "Where is the bus": read-only. The database function re-checks the flags and the guardian-learner link itself;
// anything but a clean answer throws, and the dispatcher turns a throw into an escalation to the school office.
export const busStatusTool: ToolDefinition = {
  key: "bus",
  async run(ctx: ChatContext, studentId: string): Promise<ToolResult> {
    const name = await getStudentFirstName(ctx.supabase, studentId);
    const replyText = await answerBusQuestion(
      ctx.supabase,
      { schoolId: ctx.schoolId, guardianUserId: ctx.guardianUserId, studentId },
      ctx.language ?? "en",
      name,
    );
    return { replyText };
  },
};
