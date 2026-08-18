"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function createPtSlotAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: schoolUser } = await supabase.from("school_users").select("id, school_id").eq("auth_user_id", user.id).maybeSingle();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const slotDate = String(formData.get("slot_date") ?? "");
  const startTime = String(formData.get("start_time") ?? "");
  const endTime = String(formData.get("end_time") ?? "");
  const location = String(formData.get("location") ?? "").trim();
  const capacity = Number(formData.get("capacity") ?? 1);

  if (!slotDate || !startTime || !endTime) {
    return { error: "Date, start time, and end time are all required." };
  }
  if (endTime <= startTime) {
    return { error: "End time must be after the start time." };
  }

  const { error } = await supabase.from("pt_meeting_slots").insert({
    school_id: schoolUser.school_id,
    teacher_id: schoolUser.id,
    slot_date: slotDate,
    start_time: startTime,
    end_time: endTime,
    location: location || null,
    capacity: capacity > 0 ? capacity : 1,
  });
  if (error) return { error: error.message };

  revalidatePath("/pt-meetings");
  return { success: true };
}

export async function deletePtSlotAction(slotId: string): Promise<ActionResult> {
  const supabase = await createClient();

  // pt_meeting_bookings.slot_id is ON DELETE CASCADE — without this check, deleting a slot with
  // active bookings would silently wipe out a guardian's booking with zero notification to them.
  const { count: activeBookings, error: bookingsError } = await supabase
    .from("pt_meeting_bookings")
    .select("id", { count: "exact", head: true })
    .eq("slot_id", slotId)
    .eq("status", "booked");
  if (bookingsError) return { error: bookingsError.message };
  if ((activeBookings ?? 0) > 0) {
    return {
      error: `This slot has ${activeBookings} active booking${activeBookings === 1 ? "" : "s"}. Cancel or reassign them with the guardian(s) before removing the slot.`,
    };
  }

  const { error } = await supabase.from("pt_meeting_slots").delete().eq("id", slotId);
  if (error) return { error: error.message };
  revalidatePath("/pt-meetings");
  return { success: true };
}
