import type { ChatContext, ToolDefinition, ToolResult } from "../types.ts";
import { getStudentFirstName } from "../childContext.ts";
import { feeBalanceText } from "../menu.ts";

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
    // English output is byte-for-byte what this tool always said; Kiswahili only when the school has the menu flag.
    const text = feeBalanceText(ctx.language ?? "en", { name: childName, balance });

    return { replyText: text };
  },
};
