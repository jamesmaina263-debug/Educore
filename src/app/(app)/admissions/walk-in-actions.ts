"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// "+ New Walk-In Admission" (Brief 4.16.1 Entry Point B / 4.16.8). Creates a bare `applications`
// row in 'draft' status and sends the officer straight into the same wizard used for "Continue
// Admission" from Phase 10's review screen — one onboarding engine, not two admission systems.
export async function createWalkInApplication(): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: me } = await supabase
    .from("school_users")
    .select("id, school_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!me) throw new Error("Could not identify your staff account.");

  const { data: numberResult, error: numberError } = await supabase.rpc("generate_application_number", {
    p_school_id: me.school_id,
  });
  if (numberError || !numberResult) throw new Error("Could not generate an application reference.");

  const { data: application, error } = await supabase
    .from("applications")
    .insert({
      school_id: me.school_id,
      application_number: numberResult as string,
      status: "draft",
      application_source: "walk_in",
      assigned_officer_id: me.id,
      wizard_current_step: 0,
    })
    .select("id")
    .single();
  if (error || !application) throw new Error(error?.message ?? "Could not start a walk-in admission.");

  revalidatePath("/admissions");
  redirect(`/admissions/${application.id}/wizard`);
}
