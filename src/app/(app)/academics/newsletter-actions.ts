"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

// ---------------------------------------------------------------------------
// Term newsletters (Academics > Newsletters), draft-and-approve
//
// prepare_term_newsletter_draft() only ever creates or fetches a draft --
// nothing here reaches a parent until sendTermNewsletterDraftAction is
// explicitly called. AI polish only rewrites draft_body for review; it never
// sends. Mirrors the Finance > Fee Alerts pattern in this codebase.
// ---------------------------------------------------------------------------

// Called by the manual "Prepare newsletter" button next to a term in
// Academics > Years & Terms. Idempotent both ways: if this term's newsletter
// was already sent it returns null (nothing to review); if a draft already
// exists it returns that draft's id untouched, never overwriting edits.
export async function prepareTermNewsletterDraftAction(
  termId: string,
): Promise<{ error: string } | { success: true; draftId: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prepare_term_newsletter_draft", { p_term_id: termId });
  if (error) return { error: error.message };
  revalidatePath("/academics/years-terms");
  revalidatePath("/academics/newsletters");
  return { success: true, draftId: (data as string | null) ?? null };
}

export async function updateNewsletterDraftBodyAction(draftId: string, body: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("term_newsletter_drafts")
    .update({ draft_body: body })
    .eq("id", draftId)
    .in("status", ["draft", "approved"]);
  if (error) return { error: error.message };
  revalidatePath("/academics/newsletters");
  return { success: true };
}

export async function previewTermNewsletterDraftAction(
  draftId: string,
): Promise<{ error: string } | { success: true; preview: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_term_newsletter_draft", { p_draft_id: draftId });
  if (error) return { error: error.message };
  return { success: true, preview: (data as string) ?? "" };
}

export async function sendTermNewsletterDraftAction(
  draftId: string,
): Promise<{ error: string } | { success: true; recipientCount: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_term_newsletter_draft", { p_draft_id: draftId });
  if (error) return { error: error.message };
  revalidatePath("/academics/newsletters");
  revalidatePath("/academics/years-terms");
  return { success: true, recipientCount: (data as number) ?? 0 };
}

// ---------------------------------------------------------------------------
// AI polish (Google Gemini, free tier) -- rewrites the *tone* of the draft
// template only, and is explicitly told to leave every {{placeholder}} and
// any name/figure that's already literal text untouched. Same
// never-reaches-a-parent-unreviewed principle as the fee-alert AI polish and
// report-card AI-drafted comments -- a human must still explicitly approve
// and send afterwards.
// ---------------------------------------------------------------------------

export async function polishNewsletterDraftWithAIAction(draftId: string): Promise<ActionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "AI drafting isn't configured yet -- GEMINI_API_KEY is missing from the server environment." };
  }

  const supabase = await createClient();
  const { data: draft, error: fetchError } = await supabase
    .from("term_newsletter_drafts")
    .select("draft_body, status")
    .eq("id", draftId)
    .maybeSingle();
  if (fetchError || !draft) return { error: fetchError?.message ?? "Draft not found." };
  if (draft.status !== "draft" && draft.status !== "approved") {
    return { error: "This newsletter has already been sent." };
  }

  const prompt = `You are helping a Kenyan school warm up the tone of an end-of-term newsletter template before it is reviewed and sent to parents/guardians.

Current template:
"${draft.draft_body}"

Rewrite it to sound warmer and more personable, while staying professional and reasonably brief. This is a TEMPLATE: it contains placeholders wrapped in double curly braces, e.g. {{guardian_name}}, {{student_name}}, {{school_name}}, {{term_name}}, {{next_term_name}}, {{fee_section}}. You MUST keep every placeholder that appears in the current template exactly as-is, spelled exactly the same, in a sensible position in the rewritten text. Do NOT invent new placeholders, do NOT remove any existing placeholder, and do NOT change, remove, or add any other name or figure. Output only the rewritten template, no preamble, no quotation marks.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 400 },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      return { error: `AI drafting failed (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    const draftText: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!draftText) return { error: "AI drafting returned no text." };

    // Safety net: if the model dropped a placeholder that was present before,
    // don't save it -- fall back to the original rather than silently
    // breaking the merge for every guardian.
    const placeholderPattern = /\{\{[a-z_]+\}\}/g;
    const originalBody = draft.draft_body as string;
    const before = new Set<string>(originalBody.match(placeholderPattern) ?? []);
    const after = new Set<string>(draftText.match(placeholderPattern) ?? []);
    for (const p of before) {
      if (!after.has(p)) {
        return { error: `AI rewrite dropped the ${p} placeholder -- discarded to avoid breaking the merge. Try again or edit manually.` };
      }
    }

    const { error } = await supabase
      .from("term_newsletter_drafts")
      .update({ draft_body: draftText.trim(), ai_drafted: true })
      .eq("id", draftId);
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reach the AI drafting service." };
  }

  revalidatePath("/academics/newsletters");
  return { success: true };
}
