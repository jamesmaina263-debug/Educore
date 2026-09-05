"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function updateDemoRequestStatus(id: string, status: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_demo_request_status", {
    p_id: id,
    p_status: status,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/demo-requests");
  return { success: true };
}
