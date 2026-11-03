"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import {
  STAGES,
  validateCandidate,
  validateMove,
  validateOpening,
  type CandidateInput,
  type OpeningInput,
  type Stage,
} from "@/lib/recruitment";

type ActionResult = { error: string } | { success: true };

// Recruitment pipeline. Every action is a thin call to a database function that checks the caller
// (staff.manage), the school and the feature flag itself. Nothing here sends a message or creates a login.

export async function saveOpeningAction(input: OpeningInput): Promise<ActionResult> {
  const checked = validateOpening(input);
  if ("error" in checked) return { error: checked.error };
  const o = checked.value;
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("save_recruitment_opening", {
    p_id: o.id,
    p_title: o.title,
    p_department: o.department.trim() || null,
    p_employment_type: o.employmentType,
    p_description: o.description.trim() || null,
    p_positions: o.positions,
    p_closes_on: o.closesOn || null,
    p_status: o.status,
  });
  if (error) return { error: error.message };
  revalidatePath("/staff/recruitment");
  return { success: true };
}

export async function addCandidateAction(input: CandidateInput): Promise<ActionResult> {
  const checked = validateCandidate(input);
  if ("error" in checked) return { error: checked.error };
  const c = checked.value;
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("add_recruitment_candidate", {
    p_opening_id: c.openingId,
    p_full_name: c.fullName,
    p_email: c.email || null,
    p_phone: c.phone.trim() || null,
    p_source: c.source.trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/staff/recruitment");
  return { success: true };
}

export async function moveCandidateAction(candidateId: string, from: Stage, to: Stage, note: string): Promise<ActionResult> {
  if (!candidateId) return { error: "Missing candidate." };
  if (!STAGES.includes(from) || !STAGES.includes(to)) return { error: "Unknown stage." };
  const checked = validateMove(from, to, note);
  if ("error" in checked) return { error: checked.error };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("move_recruitment_candidate", {
    p_candidate_id: candidateId,
    p_stage: to,
    p_note: note.trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/staff/recruitment");
  return { success: true };
}

export async function addNoteAction(candidateId: string, body: string): Promise<ActionResult> {
  if (!candidateId) return { error: "Missing candidate." };
  const text = body.trim();
  if (text.length < 1 || text.length > 2000) return { error: "A note must be between 1 and 2000 characters." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("add_recruitment_note", { p_candidate_id: candidateId, p_body: text });
  if (error) return { error: error.message };
  revalidatePath("/staff/recruitment");
  return { success: true };
}
