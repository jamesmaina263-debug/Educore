"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

async function schoolId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("auth_school_id");
  if (error || !data) throw new Error("Could not resolve your school.");
  return data as string;
}

// ---------- Structure: Houses -> Dormitories -> Rooms (beds auto-generated) ----------

export async function createBoardingHouse(input: {
  name: string;
  description?: string;
  gender: "male" | "female" | "mixed";
  capacity?: number;
  master_id?: string;
  assistant_id?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { error } = await supabase.from("boarding_houses").insert({
      school_id,
      name: input.name,
      description: input.description || null,
      gender: input.gender,
      capacity: input.capacity || null,
      master_id: input.master_id || null,
      assistant_id: input.assistant_id || null,
    });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the house." };
  }
  revalidatePath("/boarding");
  return { success: true };
}

export async function createDormitory(input: {
  house_id: string;
  name: string;
  gender: "male" | "female" | "mixed";
  capacity?: number;
  master_id?: string;
  assistant_id?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { error } = await supabase.from("dormitories").insert({
      school_id,
      house_id: input.house_id,
      name: input.name,
      gender: input.gender,
      capacity: input.capacity || null,
      master_id: input.master_id || null,
      assistant_id: input.assistant_id || null,
    });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the dormitory." };
  }
  revalidatePath("/boarding");
  return { success: true };
}

export async function createRoom(input: {
  dormitory_id: string;
  room_number: string;
  capacity: number;
  gender: "male" | "female" | "mixed";
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { data: room, error } = await supabase
      .from("hostel_rooms")
      .insert({
        school_id,
        dormitory_id: input.dormitory_id,
        room_number: input.room_number,
        capacity: input.capacity,
        gender: input.gender,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };

    // Auto-generate beds 1..capacity — a room's bed count always matches
    // its capacity, so this keeps them from drifting apart.
    const beds = Array.from({ length: input.capacity }, (_, i) => ({
      school_id,
      room_id: room.id,
      bed_number: String(i + 1),
    }));
    const { error: bedsError } = await supabase.from("beds").insert(beds);
    if (bedsError) return { error: bedsError.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the room." };
  }
  revalidatePath("/boarding");
  return { success: true };
}

export async function setBedStatus(
  bedId: string,
  status: "available" | "reserved" | "unavailable",
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("beds").update({ status }).eq("id", bedId);
  if (error) return { error: error.message };
  revalidatePath("/boarding");
  return { success: true };
}

// ---------- Allocation ----------

export async function allocateStudentToBed(input: {
  student_id: string;
  bed_id: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);

    // Belt-and-braces check ahead of the insert — the partial unique index
    // (hostel_alloc_bed_one_active) is the real guarantee against a race,
    // but this gives a friendly error instead of a raw constraint violation
    // in the common case.
    const { data: bed } = await supabase
      .from("beds")
      .select("id, status, room_id, hostel_rooms(room_number, gender)")
      .eq("id", input.bed_id)
      .maybeSingle();
    if (!bed) return { error: "Bed not found." };
    if (bed.status === "unavailable") return { error: "This bed is marked unavailable." };

    const roomGender = (bed.hostel_rooms as unknown as { gender: string } | null)?.gender;
    const { data: student } = await supabase.from("students").select("gender").eq("id", input.student_id).single();
    if (roomGender && roomGender !== "mixed" && student?.gender !== roomGender) {
      return { error: `This room is designated ${roomGender} — the student's gender doesn't match.` };
    }

    const { data: existingOccupant } = await supabase
      .from("hostel_allocations")
      .select("id")
      .eq("bed_id", input.bed_id)
      .eq("status", "active")
      .maybeSingle();
    if (existingOccupant) return { error: "This bed is already occupied." };

    const { error } = await supabase.from("hostel_allocations").insert({
      school_id,
      student_id: input.student_id,
      hostel_room_id: bed.room_id,
      bed_id: input.bed_id,
      start_date: new Date().toISOString().slice(0, 10),
      status: "active",
    });
    if (error) {
      if (error.code === "23505") {
        return { error: "This student or bed already has an active allocation." };
      }
      return { error: error.message };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not allocate the bed." };
  }
  revalidatePath("/boarding");
  revalidatePath("/students");
  return { success: true };
}

export async function endAllocation(allocationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("hostel_allocations")
    .update({ status: "ended", end_date: new Date().toISOString().slice(0, 10) })
    .eq("id", allocationId);
  if (error) return { error: error.message };
  revalidatePath("/boarding");
  return { success: true };
}

// ---------- Transfers ----------

export async function transferStudent(input: {
  student_id: string;
  to_bed_id: string;
  reason?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: me } = await supabase
      .from("school_users")
      .select("id")
      .eq("auth_user_id", user!.id)
      .maybeSingle();

    const { data: currentAllocation } = await supabase
      .from("hostel_allocations")
      .select("id, bed_id")
      .eq("student_id", input.student_id)
      .eq("status", "active")
      .maybeSingle();

    const { data: destOccupant } = await supabase
      .from("hostel_allocations")
      .select("id")
      .eq("bed_id", input.to_bed_id)
      .eq("status", "active")
      .maybeSingle();
    if (destOccupant) return { error: "The destination bed is already occupied." };

    if (currentAllocation) {
      await supabase.from("hostel_allocations").update({ status: "ended", end_date: new Date().toISOString().slice(0, 10) }).eq("id", currentAllocation.id);
    }

    const { data: room } = await supabase.from("beds").select("room_id").eq("id", input.to_bed_id).single();
    if (!room) return { error: "Destination bed not found." };

    const { error: allocError } = await supabase.from("hostel_allocations").insert({
      school_id,
      student_id: input.student_id,
      hostel_room_id: room.room_id,
      bed_id: input.to_bed_id,
      start_date: new Date().toISOString().slice(0, 10),
      status: "active",
    });
    if (allocError) return { error: allocError.message };

    const { error: transferError } = await supabase.from("boarding_transfers").insert({
      school_id,
      student_id: input.student_id,
      from_bed_id: currentAllocation?.bed_id ?? null,
      to_bed_id: input.to_bed_id,
      reason: input.reason || null,
      authorized_by: me?.id ?? null,
    });
    if (transferError) return { error: transferError.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not complete the transfer." };
  }
  revalidatePath("/boarding");
  return { success: true };
}

// ---------- Incidents ----------

export async function logIncident(input: {
  student_id: string;
  incident_type: string;
  location?: string;
  description: string;
  action_taken?: string;
  follow_up?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: me } = await supabase
      .from("school_users")
      .select("id")
      .eq("auth_user_id", user!.id)
      .maybeSingle();

    const { error } = await supabase.from("boarding_incidents").insert({
      school_id,
      student_id: input.student_id,
      incident_type: input.incident_type,
      location: input.location || null,
      description: input.description,
      action_taken: input.action_taken || null,
      follow_up: input.follow_up || null,
      staff_id: me?.id ?? null,
    });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not log the incident." };
  }
  revalidatePath("/boarding");
  return { success: true };
}

export async function updateIncidentStatus(incidentId: string, status: "open" | "closed"): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("boarding_incidents").update({ status }).eq("id", incidentId);
  if (error) return { error: error.message };
  revalidatePath("/boarding");
  return { success: true };
}

// ---------- Roll call (writes into the existing student_attendance table) ----------

export async function submitRollCall(
  date: string,
  session: "boarding_am" | "boarding_pm",
  entries: { student_id: string; stream_id: string; status: "present" | "absent" | "sick_bay" | "excused" | "late" }[],
): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: me } = await supabase
      .from("school_users")
      .select("id")
      .eq("auth_user_id", user!.id)
      .maybeSingle();

    const rows = entries.map((e) => ({
      school_id,
      student_id: e.student_id,
      stream_id: e.stream_id,
      attendance_date: date,
      session,
      status: e.status,
      marked_by: me?.id ?? null,
    }));

    const { error } = await supabase
      .from("student_attendance")
      .upsert(rows, { onConflict: "stream_id,student_id,attendance_date,session" });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the roll call." };
  }
  revalidatePath("/boarding");
  revalidatePath("/attendance");
  return { success: true };
}
