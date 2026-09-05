"use server";

import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Remark bank (Performance Appraisal Engine directive, Phase 10 / roadmap
// Step 11). See supabase/migrations/20260905053556_remark_bank.sql for the
// schema and the reasoning behind the category taxonomy (reuses the same
// seven core-competency names as competency_indicators) and the deliberate
// absence of a 'kicd_licensed' content_source option.
// ---------------------------------------------------------------------------

export const REMARK_BANK_CATEGORIES = [
  { value: "strength", label: "Strength" },
  { value: "progress", label: "Progress" },
  { value: "needs_support", label: "Needs Support" },
  { value: "communication_and_collaboration", label: "Communication & Collaboration" },
  { value: "critical_thinking_and_problem_solving", label: "Critical Thinking & Problem Solving" },
  { value: "creativity_and_imagination", label: "Creativity & Imagination" },
  { value: "citizenship", label: "Citizenship" },
  { value: "digital_literacy", label: "Digital Literacy" },
  { value: "learning_to_learn", label: "Learning to Learn" },
  { value: "self_efficacy", label: "Self-Efficacy" },
  { value: "general", label: "General" },
] as const;

export type RemarkBankCategory = (typeof REMARK_BANK_CATEGORIES)[number]["value"];

export interface RemarkBankEntry {
  id: string;
  category: string;
  body: string;
  is_school_authored: boolean;
}

/** Search the remark bank (global library + this school's own entries), optionally filtered by category. */
export async function searchRemarkBank(input: {
  category?: string;
  query?: string;
}): Promise<{ items: RemarkBankEntry[] } | { error: string }> {
  const supabase = await createClient();
  let q = supabase.from("remark_bank_entries").select("id, school_id, category, body").eq("is_active", true);
  if (input.category) q = q.eq("category", input.category);
  if (input.query?.trim()) q = q.ilike("body", `%${input.query.trim()}%`);
  const { data, error } = await q.order("category").limit(50);
  if (error) return { error: error.message };
  return {
    items: (data ?? []).map((r) => ({
      id: r.id,
      category: r.category,
      body: r.body,
      is_school_authored: r.school_id !== null,
    })),
  };
}

export async function addRemarkBankEntry(input: {
  category: string;
  body: string;
}): Promise<{ id: string } | { error: string }> {
  if (!input.body.trim()) return { error: "Remark text is required." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase.from("school_users").select("id, school_id").eq("auth_user_id", user?.id ?? "").maybeSingle();
  if (!schoolUser) return { error: "Could not resolve your school." };

  const { data, error } = await supabase
    .from("remark_bank_entries")
    .insert({ school_id: schoolUser.school_id, category: input.category, body: input.body.trim(), created_by: schoolUser.id })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id };
}
