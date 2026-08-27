import type { ChatContext, ToolDefinition, ToolResult } from "../types.ts";
import { getStudentFirstName } from "../childContext.ts";

// run() only ever returns text built from a query result -- there is no code path here that lets
// the reply contain a number that didn't come straight out of v_student_balances.
export const feeBalanceTool: ToolDefinition = {
  key: "fee_balance",
  async run(ctx: ChatContext, studentId: string): Promise<ToolResult> {
    const { data, error } = await ctx.supabase.from("v_student_balances").select("balance").eq("student_id", studentId).maybeSingle();

    if (error || !data) {
      throw new Error(error?.message ?? "No balance row found for student.");
    }

    const balance = Number(data.balance ?? 0);
    const childName = await getStudentFirstName(ctx.supabase, studentId);
    const text =
      balance <= 0
        ? `${childName}'s fee account is fully paid up${balance < 0 ? ` (a credit of KES ${Math.abs(balance).toLocaleString()})` : ""}. No outstanding balance.`
        : `${childName}'s outstanding fee balance is KES ${balance.toLocaleString()}.`;

    return { replyText: text };
  },
};
