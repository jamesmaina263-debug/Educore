"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { validateEvent, validateHouse, type EventInput, type HouseInput } from "@/lib/school-calendar";

type ActionResult = { error: string } | { success: true };

// Events and houses calendar. Every action is a thin call to a database function that checks the
// caller (academics.write), the school and the feature flag itself. Nothing here sends a message.

export async function saveEventAction(input: EventInput): Promise<ActionResult> {
  const checked = validateEvent(input);
  if ("error" in checked) return { error: checked.error };
  const e = checked.value;
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("save_school_event", {
    p_id: e.id,
    p_title: e.title,
    p_description: e.description.trim() || null,
    p_category: e.category,
    p_starts_on: e.startsOn,
    p_ends_on: e.endsOn,
    p_start_time: e.startTime || null,
    p_end_time: e.endTime || null,
    p_location: e.location.trim() || null,
    p_house_id: e.houseId,
    p_audience: e.audience,
  });
  if (error) return { error: error.message };
  revalidatePath("/calendar");
  return { success: true };
}

export async function cancelEventAction(id: string, reason: string): Promise<ActionResult> {
  if (!id) return { error: "Missing event." };
  if (reason.length > 500) return { error: "The reason is too long (500 characters at most)." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("cancel_school_event", { p_id: id, p_reason: reason.trim() || null });
  if (error) return { error: error.message };
  revalidatePath("/calendar");
  return { success: true };
}

export async function saveHouseAction(input: HouseInput): Promise<ActionResult> {
  const checked = validateHouse(input);
  if ("error" in checked) return { error: checked.error };
  const h = checked.value;
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("save_school_house", {
    p_id: h.id,
    p_name: h.name,
    p_colour: h.colour,
    p_status: h.status,
  });
  if (error) {
    // The unique index on (school, lower(name)) surfaces as a raw constraint message.
    if (error.code === "23505") return { error: "A house with that name already exists." };
    return { error: error.message };
  }
  revalidatePath("/calendar");
  return { success: true };
}
