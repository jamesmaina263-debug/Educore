"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import { geminiGenerateContentUrl, geminiHeaders } from "@/lib/ai/report-card-comment";
import { isUuid } from "@/lib/sales/pipeline";
import {
  MAX_SCORE_BATCH,
  buildScoringPrompt,
  parseProspectCsv,
  parseScoringResponse,
  type ProspectForScoring,
} from "@/lib/outbound/prospects";

type ActionResult = { error: string } | { success: true };

const PATH = "/admin/outreach";
const GEMINI_OUTREACH_MODEL = "gemini-3.5-flash-lite";

// Every mutation goes through a SECURITY DEFINER RPC that re-checks auth_is_super_admin() in the
// database (see 20261016120000_outbound_prospecting.sql). Nothing here sends a message: this
// module only imports, scores/drafts, reviews and promotes. Audit-log detail carries ids and
// counts only, never a school's contact details.

export async function importOutboundProspects(
  csvText: string,
  sourceNote: string,
): Promise<{ error: string } | { success: true; inserted: number; skipped: number; warnings: string[] }> {
  const note = (sourceNote ?? "").trim();
  if (!note) return { error: "Say where this list came from (it is kept so you can answer \"how did you get my details\")." };
  if (note.length > 300) return { error: "Source note is too long (max 300 characters)." };
  if (typeof csvText !== "string" || csvText.length > 500_000) return { error: "That file is too large." };

  const parsed = parseProspectCsv(csvText);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("admin_import_outbound_prospects", {
    p_rows: parsed.value.rows,
    p_source_note: note,
  });
  if (error) return { error: error.message };

  const result = (data ?? {}) as { inserted?: number; skipped?: number };
  const inserted = result.inserted ?? 0;
  const skipped = result.skipped ?? 0;
  void logAdminAction(supabase, "import_outbound_prospects", { inserted, skipped });
  revalidatePath(PATH);
  return { success: true, inserted, skipped, warnings: parsed.value.warnings };
}

export async function scoreOutboundProspects(
  ids: string[],
): Promise<{ error: string } | { success: true; scored: number; failed: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: "AI scoring isn't configured: GEMINI_API_KEY is missing from the server environment." };
  if (!Array.isArray(ids) || ids.length === 0) return { error: "Choose at least one prospect to score." };
  if (ids.length > MAX_SCORE_BATCH) return { error: `Score at most ${MAX_SCORE_BATCH} prospects at a time.` };
  if (!ids.every(isUuid)) return { error: "Invalid prospect id." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  // RLS limits this read to platform super admins, so a non-admin just gets nothing back.
  const { data: rows, error: readErr } = await supabase
    .from("outbound_prospects")
    .select("id, school_name, town_county, school_type, website, contact_name, contact_role, student_count, status")
    .in("id", ids);
  if (readErr) return { error: readErr.message };
  if (!rows || rows.length === 0) return { error: "Those prospects weren't found." };

  let scored = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.status !== "new" && row.status !== "scored") continue; // never re-score a reviewed row
    try {
      const prompt = buildScoringPrompt(row as ProspectForScoring);
      const res = await fetch(geminiGenerateContentUrl(apiKey, GEMINI_OUTREACH_MODEL), {
        method: "POST",
        headers: geminiHeaders(apiKey),
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
        }),
      });
      if (!res.ok) throw new Error(`Gemini responded ${res.status}`);
      const body = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const parsed = parseScoringResponse(text);
      if (!parsed.ok) throw new Error(parsed.error);

      const v = parsed.value;
      const { error } = await supabase.rpc("admin_set_outbound_prospect_scoring", {
        p_id: row.id,
        p_fit_score: v.fit_score,
        p_fit_reason: v.fit_reason,
        p_email_subject: v.email_subject,
        p_email_body: v.email_body,
        p_whatsapp: v.whatsapp,
      });
      if (error) throw new Error(error.message);
      scored++;
    } catch (e) {
      console.error("scoreOutboundProspects: failed for", row.id, e instanceof Error ? e.message : e);
      failed++;
    }
  }

  void logAdminAction(supabase, "score_outbound_prospects", { scored, failed });
  revalidatePath(PATH);
  return { success: true, scored, failed };
}

export async function reviewOutboundProspect(id: string, decision: string): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "Invalid prospect id." };
  if (decision !== "approved" && decision !== "rejected" && decision !== "scored") return { error: "Invalid decision." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_review_outbound_prospect", { p_id: id, p_decision: decision });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "review_outbound_prospect", { prospect_id: id, decision });
  revalidatePath(PATH);
  return { success: true };
}

export async function promoteOutboundProspect(
  id: string,
  assignedTo: string | null,
): Promise<ActionResult & { leadId?: string }> {
  if (!isUuid(id)) return { error: "Invalid prospect id." };
  if (assignedTo && !isUuid(assignedTo)) return { error: "Invalid rep." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("admin_promote_outbound_prospect", {
    p_id: id,
    p_assigned_to: assignedTo || null,
  });
  if (error) return { error: error.message };

  const leadId = typeof data === "string" ? data : undefined;
  void logAdminAction(supabase, "promote_outbound_prospect", { prospect_id: id, lead_id: leadId });
  revalidatePath(PATH);
  revalidatePath("/admin/sales-pipeline");
  return { success: true, leadId };
}

export async function deleteOutboundProspect(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "Invalid prospect id." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_delete_outbound_prospect", { p_id: id });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "delete_outbound_prospect", { prospect_id: id });
  revalidatePath(PATH);
  return { success: true };
}
