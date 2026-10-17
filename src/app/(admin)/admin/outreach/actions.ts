"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import {
  addUsage,
  aiDisabledReason,
  generatePlatformText,
  parseBudgetMs,
  type AiUsage,
} from "@/lib/ai/platform-ai";
import { isUuid } from "@/lib/sales/pipeline";
import {
  buildOverpassQuery,
  discoverySourceNote,
  isKenyaCounty,
  parseOverpassResponse,
  type DiscoveryKinds,
} from "@/lib/outbound/discovery";
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

// Public Overpass instances, tried in order. Be a polite client: identify ourselves, one county per
// request, and never retry in a tight loop.
const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

async function fetchOverpass(query: string): Promise<unknown> {
  let lastError = "no endpoint answered";
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "EduCore-Outreach/1.0 (school discovery)" },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(55_000),
        cache: "no-store",
      });
      if (!res.ok) {
        lastError = `${new URL(endpoint).host} responded ${res.status}`;
        continue;
      }
      return await res.json();
    } catch (e) {
      lastError = `${new URL(endpoint).host}: ${e instanceof Error ? e.message : "request failed"}`;
    }
  }
  throw new Error(lastError);
}

/**
 * Finds schools (and, optionally, kindergartens) in one county from OpenStreetMap and stages them
 * for review. Staging only: nothing is scored, approved or sent by this call.
 */
export async function discoverSchoolsByCounty(
  county: string,
  kinds: string,
): Promise<
  | { error: string }
  | { success: true; found: number; inserted: number; skipped: number; truncated: number; withContact: number }
> {
  if (!isKenyaCounty(county)) return { error: "Choose a county from the list." };
  if (kinds !== "all" && kinds !== "kindergartens" && kinds !== "schools") return { error: "Invalid school kind." };

  let data: unknown;
  try {
    data = await fetchOverpass(buildOverpassQuery(county, kinds as DiscoveryKinds));
  } catch (e) {
    console.error("discoverSchoolsByCounty: overpass failed", e instanceof Error ? e.message : e);
    return { error: "The map data service didn't respond. Wait a minute and try again, or try a smaller county first." };
  }

  const { rows, truncated } = parseOverpassResponse(data, county);
  if (rows.length === 0) return { error: `No named schools were found for ${county}. OpenStreetMap coverage varies by county.` };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data: result, error } = await supabase.rpc("admin_import_outbound_prospects", {
    p_rows: rows,
    p_source_note: discoverySourceNote(county, new Date()),
  });
  if (error) return { error: error.message };

  const r = (result ?? {}) as { inserted?: number; skipped?: number };
  const inserted = r.inserted ?? 0;
  const skipped = r.skipped ?? 0;
  void logAdminAction(supabase, "discover_outbound_prospects", { county, kinds, found: rows.length, inserted, skipped });
  revalidatePath(PATH);
  return {
    success: true,
    found: rows.length,
    inserted,
    skipped,
    truncated,
    withContact: rows.filter((x) => x.email || x.phone).length,
  };
}

// How long one "Score & draft" click may keep starting new AI calls. Prospects not reached stay
// selectable for the next click. Kept low by default so a click cannot outrun a small serverless
// time limit (the free hosting plan's limit is unverified); raise OUTREACH_SCORE_BUDGET_MS once the
// real limit is known.
const DEFAULT_SCORE_BUDGET_MS = 8_000;

export async function scoreOutboundProspects(
  ids: string[],
): Promise<{ error: string } | { success: true; scored: number; failed: number; skipped: number }> {
  if (!Array.isArray(ids) || ids.length === 0) return { error: "Choose at least one prospect to score." };
  if (ids.length > MAX_SCORE_BATCH) return { error: `Score at most ${MAX_SCORE_BATCH} prospects at a time.` };
  if (!ids.every(isUuid)) return { error: "Invalid prospect id." };

  // Fail fast, before any database read, when AI is switched off or not configured.
  const off = aiDisabledReason("outreach_scoring");
  if (off) return { error: off };
  if (!process.env.GEMINI_API_KEY) {
    return { error: "AI scoring isn't configured: GEMINI_API_KEY is missing from the server environment." };
  }

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  // RLS limits this read to platform super admins, so a non-admin just gets nothing back.
  const { data: rows, error: readErr } = await supabase
    .from("outbound_prospects")
    .select("id, school_name, town_county, school_type, school_level, website, contact_name, contact_role, student_count, status")
    .in("id", ids);
  if (readErr) return { error: readErr.message };
  if (!rows || rows.length === 0) return { error: "Those prospects weren't found." };

  const budgetMs = parseBudgetMs(process.env.OUTREACH_SCORE_BUDGET_MS, DEFAULT_SCORE_BUDGET_MS, 2_000, 50_000);
  const startedAt = Date.now();
  let usage: AiUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
  let scored = 0;
  let failed = 0;
  let skipped = 0;
  let aiStopped = false;

  for (const row of rows) {
    if (row.status !== "new" && row.status !== "scored") continue; // never re-score a reviewed row
    const elapsed = Date.now() - startedAt;
    if (aiStopped || elapsed >= budgetMs) {
      skipped++;
      continue;
    }
    try {
      const ai = await generatePlatformText({
        task: "outreach_scoring",
        prompt: buildScoringPrompt(row as ProspectForScoring),
        json: true,
        temperature: 0.4,
        model: GEMINI_OUTREACH_MODEL,
        maxOutputTokens: 1024,
        timeoutMs: Math.min(20_000, Math.max(3_000, budgetMs - elapsed)),
      });
      if (!ai.ok) {
        // Switched off or unconfigured mid-run: stop calling, leave the rest for later.
        if (ai.reason === "disabled" || ai.reason === "not_configured") {
          aiStopped = true;
          skipped++;
          continue;
        }
        throw new Error(ai.error);
      }
      usage = addUsage(usage, ai.usage);

      const parsed = parseScoringResponse(ai.text);
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

  void logAdminAction(supabase, "score_outbound_prospects", {
    scored,
    failed,
    skipped,
    model: GEMINI_OUTREACH_MODEL,
    prompt_tokens: usage.promptTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
  });
  revalidatePath(PATH);
  return { success: true, scored, failed, skipped };
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
