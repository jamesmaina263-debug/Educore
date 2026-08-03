"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function createInventoryItemAction(input: {
  name: string;
  description?: string;
  unit: string;
  reorder_level?: number;
  location?: string;
  category_id?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase.from("school_users").select("school_id").eq("auth_user_id", user?.id ?? "").maybeSingle();
  if (!schoolUser) return { error: "No school context found" };

  const { error } = await supabase.from("inventory_items").insert({
    school_id: schoolUser.school_id,
    name: input.name,
    description: input.description || null,
    unit: input.unit || "pieces",
    quantity: 0,
    reorder_level: input.reorder_level ?? null,
    location: input.location || null,
    category_id: input.category_id || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/inventory");
  return { success: true };
}

export async function createCategoryAction(name: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase.from("school_users").select("school_id").eq("auth_user_id", user?.id ?? "").maybeSingle();
  if (!schoolUser) return { error: "No school context found" };

  const { error } = await supabase.from("inventory_categories").insert({ school_id: schoolUser.school_id, name });
  if (error) return { error: error.message };
  revalidatePath("/inventory");
  return { success: true };
}

export async function recordStockMovementAction(input: {
  item_id: string;
  movement_type: "in" | "out";
  quantity: number;
  reason?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_stock_movement", {
    p_item_id: input.item_id,
    p_movement_type: input.movement_type,
    p_quantity: input.quantity,
    p_reason: input.reason || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/inventory");
  return { success: true };
}
