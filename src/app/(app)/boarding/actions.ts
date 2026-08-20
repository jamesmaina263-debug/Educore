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
  revalidatePath("/boarding", "layout");
  return { success: true };
}

export async function createDormitory(input: {
  // Optional -- a school using flat "Dormitory" naming with no House concept
  // can create one without a parent house (Brief item #5: House is optional).
  house_id?: string;
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
      house_id: input.house_id || null,
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
  revalidatePath("/boarding", "layout");
  return { success: true };
}

export async function createRoom(input: {
  // At most one of these -- a room can sit under a dormitory, directly under a
  // house (skipping Dormitory), or standalone under neither (Brief item #5:
  // Division/Cubicle are both optional). Enforced again server-side by
  // hostel_rooms_one_parent_check regardless of what the client sends.
  dormitory_id?: string;
  house_id?: string;
  room_number: string;
  capacity: number;
  gender: "male" | "female" | "mixed";
}): Promise<ActionResult> {
  if (input.dormitory_id && input.house_id) {
    return { error: "A room can belong to a dormitory or directly to a house, not both." };
  }
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { data: room, error } = await supabase
      .from("hostel_rooms")
      .insert({
        school_id,
        dormitory_id: input.dormitory_id || null,
        house_id: input.house_id || null,
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
  revalidatePath("/boarding", "layout");
  return { success: true };
}

export async function setBedStatus(
  bedId: string,
  status: "available" | "reserved" | "unavailable",
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("beds").update({ status }).eq("id", bedId);
  if (error) return { error: error.message };
  revalidatePath("/boarding", "layout");
  return { success: true };
}

// Houses/dormitories/rooms could be created but never taken back out of service --
// no action anywhere ever touched their status columns despite the schema (and, for
// beds one level down, the UI) supporting it. Reactivating is always allowed with no
// check (mirrors setBedStatus and the student-status work); leaving 'active' is blocked
// while any bed underneath still has a live occupant, so staff move students out first
// rather than a room silently going "under maintenance" with someone still living in it.

async function countActiveOccupants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scope: { house_id?: string; dormitory_id?: string; hostel_room_id?: string },
): Promise<number> {
  let roomIds: string[] | null = null;

  if (scope.hostel_room_id) {
    roomIds = [scope.hostel_room_id];
  } else if (scope.dormitory_id) {
    const { data } = await supabase.from("hostel_rooms").select("id").eq("dormitory_id", scope.dormitory_id);
    roomIds = (data ?? []).map((r) => r.id);
  } else if (scope.house_id) {
    const { data: dorms } = await supabase.from("dormitories").select("id").eq("house_id", scope.house_id);
    const dormIds = (dorms ?? []).map((d) => d.id);
    const orClauses = [`house_id.eq.${scope.house_id}`, ...(dormIds.length ? [`dormitory_id.in.(${dormIds.join(",")})`] : [])];
    const { data: rooms } = await supabase.from("hostel_rooms").select("id").or(orClauses.join(","));
    roomIds = (rooms ?? []).map((r) => r.id);
  }

  if (!roomIds || roomIds.length === 0) return 0;
  const { count } = await supabase
    .from("hostel_allocations")
    .select("id", { count: "exact", head: true })
    .in("hostel_room_id", roomIds)
    .eq("status", "active");
  return count ?? 0;
}

export async function updateBoardingHouseStatus(
  houseId: string,
  status: "active" | "inactive",
): Promise<ActionResult> {
  const supabase = await createClient();
  if (status !== "active") {
    const occupied = await countActiveOccupants(supabase, { house_id: houseId });
    if (occupied > 0) {
      return { error: `${occupied} student${occupied === 1 ? " is" : "s are"} still allocated a bed in this house — move them out first.` };
    }
  }
  const { error } = await supabase.from("boarding_houses").update({ status }).eq("id", houseId);
  if (error) return { error: error.message };
  revalidatePath("/boarding", "layout");
  return { success: true };
}

export async function updateDormitoryStatus(
  dormitoryId: string,
  status: "active" | "inactive",
): Promise<ActionResult> {
  const supabase = await createClient();
  if (status !== "active") {
    const occupied = await countActiveOccupants(supabase, { dormitory_id: dormitoryId });
    if (occupied > 0) {
      return { error: `${occupied} student${occupied === 1 ? " is" : "s are"} still allocated a bed in this dormitory — move them out first.` };
    }
  }
  const { error } = await supabase.from("dormitories").update({ status }).eq("id", dormitoryId);
  if (error) return { error: error.message };
  revalidatePath("/boarding", "layout");
  return { success: true };
}

export async function updateRoomStatus(
  roomId: string,
  status: "active" | "maintenance" | "inactive",
): Promise<ActionResult> {
  const supabase = await createClient();
  if (status !== "active") {
    const occupied = await countActiveOccupants(supabase, { hostel_room_id: roomId });
    if (occupied > 0) {
      return { error: `${occupied} student${occupied === 1 ? " is" : "s are"} still allocated a bed in this room — move them out first.` };
    }
  }
  const { error } = await supabase.from("hostel_rooms").update({ status }).eq("id", roomId);
  if (error) return { error: error.message };
  revalidatePath("/boarding", "layout");
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
      .select("id, status, room_id, hostel_rooms(room_number, gender, status, house_id, dormitory_id)")
      .eq("id", input.bed_id)
      .maybeSingle();
    if (!bed) return { error: "Bed not found." };
    if (bed.status === "unavailable") return { error: "This bed is marked unavailable." };

    const room = bed.hostel_rooms as unknown as {
      room_number: string;
      gender: string;
      status: string;
      house_id: string | null;
      dormitory_id: string | null;
    } | null;
    if (room?.status && room.status !== "active") {
      return { error: `This room is marked ${room.status} and isn't taking new occupants.` };
    }
    if (room?.dormitory_id) {
      const { data: dorm } = await supabase.from("dormitories").select("status").eq("id", room.dormitory_id).maybeSingle();
      if (dorm && dorm.status !== "active") {
        return { error: "This dormitory is marked inactive and isn't taking new occupants." };
      }
    }
    if (room?.house_id) {
      const { data: house } = await supabase.from("boarding_houses").select("status").eq("id", room.house_id).maybeSingle();
      if (house && house.status !== "active") {
        return { error: "This house is marked inactive and isn't taking new occupants." };
      }
    }

    const roomGender = room?.gender;
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
  revalidatePath("/boarding", "layout");
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
  revalidatePath("/boarding", "layout");
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

    const { data: destBed } = await supabase
      .from("beds")
      .select("id, status, room_id, hostel_rooms(gender)")
      .eq("id", input.to_bed_id)
      .maybeSingle();
    if (!destBed) return { error: "Destination bed not found." };
    if (destBed.status === "unavailable") return { error: "The destination bed is marked unavailable." };

    const destRoomGender = (destBed.hostel_rooms as unknown as { gender: string } | null)?.gender;
    const { data: student } = await supabase.from("students").select("gender").eq("id", input.student_id).single();
    if (destRoomGender && destRoomGender !== "mixed" && student?.gender !== destRoomGender) {
      return { error: `The destination room is designated ${destRoomGender} — the student's gender doesn't match.` };
    }

    if (currentAllocation) {
      await supabase.from("hostel_allocations").update({ status: "ended", end_date: new Date().toISOString().slice(0, 10) }).eq("id", currentAllocation.id);
    }

    const { error: allocError } = await supabase.from("hostel_allocations").insert({
      school_id,
      student_id: input.student_id,
      hostel_room_id: destBed.room_id,
      bed_id: input.to_bed_id,
      start_date: new Date().toISOString().slice(0, 10),
      status: "active",
    });
    if (allocError) {
      if (allocError.code === "23505") {
        return { error: "This student or bed already has an active allocation." };
      }
      return { error: allocError.message };
    }

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
  revalidatePath("/boarding", "layout");
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
  revalidatePath("/boarding", "layout");
  return { success: true };
}

export async function updateIncidentStatus(incidentId: string, status: "open" | "closed"): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("boarding_incidents").update({ status }).eq("id", incidentId);
  if (error) return { error: error.message };
  revalidatePath("/boarding", "layout");
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
  revalidatePath("/boarding", "layout");
  revalidatePath("/attendance");
  return { success: true };
}
