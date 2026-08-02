"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function createHostelRoomAction(input: {
  room_number: string;
  block?: string;
  capacity: number;
  gender: "male" | "female" | "mixed";
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase.from("school_users").select("school_id").eq("auth_user_id", user?.id ?? "").maybeSingle();
  if (!schoolUser) return { error: "No school context found" };

  const { error } = await supabase.from("hostel_rooms").insert({
    school_id: schoolUser.school_id,
    room_number: input.room_number,
    block: input.block || null,
    capacity: input.capacity,
    gender: input.gender,
  });
  if (error) return { error: error.message };
  revalidatePath("/hostel");
  return { success: true };
}

export async function allocateHostelRoomAction(input: { student_id: string; hostel_room_id: string }): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("allocate_hostel_room", {
    p_student_id: input.student_id,
    p_room_id: input.hostel_room_id,
  });
  if (error) return { error: error.message };
  revalidatePath("/hostel");
  return { success: true };
}

export async function endHostelAllocationAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_hostel_allocation", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/hostel");
  return { success: true };
}
