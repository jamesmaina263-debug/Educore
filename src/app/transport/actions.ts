"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function createRouteAction(input: { name: string; description?: string; fee_amount: number }): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase.from("school_users").select("school_id").eq("auth_user_id", user?.id ?? "").maybeSingle();
  if (!schoolUser) return { error: "No school context found" };

  const { error } = await supabase.from("transport_routes").insert({
    school_id: schoolUser.school_id,
    name: input.name,
    description: input.description || null,
    fee_amount: input.fee_amount,
  });
  if (error) return { error: error.message };
  revalidatePath("/transport");
  return { success: true };
}

export async function createVehicleAction(input: {
  registration_number: string;
  capacity: number;
  route_id?: string;
  driver_name?: string;
  driver_phone?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase.from("school_users").select("school_id").eq("auth_user_id", user?.id ?? "").maybeSingle();
  if (!schoolUser) return { error: "No school context found" };

  const { error } = await supabase.from("transport_vehicles").insert({
    school_id: schoolUser.school_id,
    registration_number: input.registration_number,
    capacity: input.capacity,
    route_id: input.route_id || null,
    driver_name: input.driver_name || null,
    driver_phone: input.driver_phone || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/transport");
  return { success: true };
}

export async function assignTransportAction(input: {
  student_id: string;
  route_id: string;
  vehicle_id?: string;
  pickup_point?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_transport", {
    p_student_id: input.student_id,
    p_route_id: input.route_id,
    p_vehicle_id: input.vehicle_id || null,
    p_pickup_point: input.pickup_point || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/transport");
  return { success: true };
}

export async function endTransportAssignmentAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_transport_assignment", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/transport");
  return { success: true };
}
