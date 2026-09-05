"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

// ---------------------------------------------------------------------------
// Structured rubrics (Performance Appraisal Engine directive, Step 7).
// Extends curriculum_sub_strands.rubric_text with a real criteria x
// performance-level grid, scored per learner. See
// supabase/migrations/20260904074049_structured_rubrics.sql for the schema
// and the reasoning behind reusing grading_scale_bands as the performance
// levels instead of a new enum. Everything here follows the same
// single-purpose-action style as the rest of exams/actions.ts rather than
// one big diffing "save rubric" call.
// ---------------------------------------------------------------------------

async function schoolUserId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("school_users").select("id").eq("auth_user_id", user?.id ?? "").maybeSingle();
  return data?.id ?? null;
}

export async function createRubric(input: { sub_strand_id: string; title?: string }): Promise<
  { id: string } | { error: string }
> {
  const supabase = await createClient();
  const created_by = await schoolUserId(supabase);
  const { data, error } = await supabase
    .from("rubrics")
    .insert({ sub_strand_id: input.sub_strand_id, title: input.title || null, created_by })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/exams/marks");
  return { id: data.id };
}

export async function addRubricCriterion(input: {
  rubric_id: string;
  name: string;
  description?: string;
  display_order?: number;
}): Promise<{ id: string } | { error: string }> {
  if (!input.name.trim()) return { error: "Criterion name is required." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rubric_criteria")
    .insert({
      rubric_id: input.rubric_id,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      display_order: input.display_order ?? 0,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/exams/marks");
  return { id: data.id };
}

export async function updateRubricCriterion(input: {
  id: string;
  name: string;
  description?: string;
}): Promise<ActionResult> {
  if (!input.name.trim()) return { error: "Criterion name is required." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("rubric_criteria")
    .update({ name: input.name.trim(), description: input.description?.trim() || null })
    .eq("id", input.id);
  if (error) return { error: error.message };
  revalidatePath("/exams/marks");
  return { success: true };
}

export async function deleteRubricCriterion(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("rubric_criteria").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/exams/marks");
  return { success: true };
}

/** Upsert one (criterion, band) descriptor cell. */
export async function saveRubricLevelDescriptor(input: {
  criterion_id: string;
  band_id: string;
  descriptor: string;
}): Promise<ActionResult> {
  if (!input.descriptor.trim()) return { error: "Descriptor text can't be empty." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("rubric_level_descriptors")
    .upsert(
      { criterion_id: input.criterion_id, band_id: input.band_id, descriptor: input.descriptor.trim() },
      { onConflict: "criterion_id,band_id" },
    );
  if (error) return { error: error.message };
  revalidatePath("/exams/marks");
  return { success: true };
}

export async function deleteRubricLevelDescriptor(input: { criterion_id: string; band_id: string }): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("rubric_level_descriptors")
    .delete()
    .eq("criterion_id", input.criterion_id)
    .eq("band_id", input.band_id);
  if (error) return { error: error.message };
  revalidatePath("/exams/marks");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Learner scoring -- one row per (competency_mark_id, criterion_id). Mirrors
// editCompetencyMark's closed-exam edit_reason requirement exactly, enforced
// server-side by rubric_criterion_scores_lock either way.
// ---------------------------------------------------------------------------

export async function saveRubricCriterionScore(input: {
  competency_mark_id: string;
  criterion_id: string;
  band_id: string;
  feedback?: string;
  edit_reason?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const school_id = await (async () => {
    const { data } = await supabase.rpc("auth_school_id");
    return data as string | null;
  })();
  if (!school_id) return { error: "Could not resolve your school." };
  const entered_by = await schoolUserId(supabase);

  const { error } = await supabase.from("rubric_criterion_scores").upsert(
    {
      school_id,
      competency_mark_id: input.competency_mark_id,
      criterion_id: input.criterion_id,
      band_id: input.band_id,
      feedback: input.feedback?.trim() || null,
      entered_by,
      edit_reason: input.edit_reason || null,
    },
    { onConflict: "competency_mark_id,criterion_id" },
  );
  if (error) return { error: error.message };
  revalidatePath("/exams/marks");
  return { success: true };
}

export async function listRubricCriterionScores(
  competencyMarkId: string,
): Promise<{ items: { criterion_id: string; band_id: string; feedback: string | null }[] } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rubric_criterion_scores")
    .select("criterion_id, band_id, feedback")
    .eq("competency_mark_id", competencyMarkId);
  if (error) return { error: error.message };
  return { items: data ?? [] };
}

// ---------------------------------------------------------------------------
// Read: full rubric (criteria + descriptors) for a set of sub-strands, used
// both by the curriculum-management editor and the scoring panel so they
// stay in sync off one query shape.
// ---------------------------------------------------------------------------

export interface RubricDetail {
  id: string;
  sub_strand_id: string;
  title: string | null;
  criteria: {
    id: string;
    name: string;
    description: string | null;
    display_order: number;
    descriptors: { band_id: string; descriptor: string }[];
  }[];
}

export async function listRubricsForSubStrands(subStrandIds: string[]): Promise<RubricDetail[]> {
  if (subStrandIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("rubrics")
    .select(
      "id, sub_strand_id, title, rubric_criteria(id, name, description, display_order, rubric_level_descriptors(band_id, descriptor))",
    )
    .in("sub_strand_id", subStrandIds);

  return (data ?? []).map((r) => ({
    id: r.id,
    sub_strand_id: r.sub_strand_id,
    title: r.title,
    criteria: (
      (r.rubric_criteria as unknown as {
        id: string;
        name: string;
        description: string | null;
        display_order: number;
        rubric_level_descriptors: { band_id: string; descriptor: string }[];
      }[]) ?? []
    )
      .sort((a, b) => a.display_order - b.display_order)
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        display_order: c.display_order,
        descriptors: c.rubric_level_descriptors ?? [],
      })),
  }));
}
