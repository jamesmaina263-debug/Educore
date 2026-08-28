"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function createConnectItemAction(input: {
  studentId: string;
  category: "request" | "academic" | "attendance";
  title: string;
  body: string;
  dueDate: string | null;
  requiresResponse: boolean;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_connect_item", {
    p_student_id: input.studentId,
    p_category: input.category,
    p_title: input.title,
    p_body: input.body,
    p_due_date: input.dueDate,
    p_requires_response: input.requiresResponse,
  });
  if (error) return { error: error.message };
  revalidatePath("/connect");
  return { success: true };
}

export async function resolveConnectItemAction(itemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_connect_item", { p_item_id: itemId });
  if (error) return { error: error.message };
  revalidatePath("/connect");
  return { success: true };
}
