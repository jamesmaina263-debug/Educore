"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";

// "+ New Walk-In Admission" (Brief 4.16.1 Entry Point B / 4.16.8). Creates a bare `applications`
// row in 'draft' status and sends the officer straight into the same wizard used for "Continue
// Admission" from Phase 10's review screen — one onboarding engine, not two admission systems.
const REUSE_BLANK_DRAFT_MINUTES = 30;

export async function createWalkInApplication(): Promise<void> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

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

  // Don't pile up empty drafts: if this officer already has a walk-in draft they started in the last
  // half hour and haven't named or advanced yet, open that one. (The button also disables itself while
  // working, but a second tab or a slow connection can still send two requests.)
  const since = new Date(Date.now() - REUSE_BLANK_DRAFT_MINUTES * 60_000).toISOString();
  const { data: blankDraft } = await supabase
    .from("applications")
    .select("id")
    .eq("school_id", me.school_id)
    .eq("assigned_officer_id", me.id)
    .eq("application_source", "walk_in")
    .eq("status", "draft")
    .eq("wizard_current_step", 0)
    .is("first_name", null)
    .is("last_name", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (blankDraft) redirect(`/admissions/${blankDraft.id}/wizard`);

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
