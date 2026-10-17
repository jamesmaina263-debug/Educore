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
  MAX_ENRICH_BATCH,
  buildEnrichmentPrompt,
  extractContactsFromHtml,
  isSafePublicUrl,
  parseEnrichmentResponse,
  pickBestEmail,
  verifyFoundContacts,
} from "@/lib/outbound/enrichment";
import { safeFetchPage } from "@/lib/outbound/safe-fetch";
import {
  isContactChannel,
  isOptOutReason,
  validateContactInput,
  type ContactLogRow,
} from "@/lib/outbound/contact";
import {
  MAX_SCORE_BATCH,
  normalizeManualContacts,
  type ManualContactsInput,
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

type EnrichRow = {
  id: string;
  school_name: string;
  town_county: string | null;
  school_level: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  contact_name: string | null;
  contact_role: string | null;
  status: string;
};

type Additions = {
  website: string | null;
  phone: string | null;
  email: string | null;
  contact_name: string | null;
  contact_role: string | null;
};

const CONTACT_PAGES = ["/", "/contact", "/contact-us", "/contacts", "/about", "/about-us"];

// Model for the web-search lookup. Overridable because the grounded-search tool is only available on
// some models; defaults to the model the rest of the app already uses.
const GEMINI_ENRICH_MODEL = process.env.GEMINI_ENRICH_MODEL || GEMINI_OUTREACH_MODEL;

type Found = { add: Additions; sourceUrl: string; method: "scraped" | "ai_found" };

const hasAny = (a: Additions) => Boolean(a.website || a.phone || a.email || a.contact_name);

/** Phase 1: read the school's OWN website. Deterministic and uses no AI quota. */
async function scrapeOne(row: EnrichRow): Promise<Found | null> {
  if (!row.website || !isSafePublicUrl(row.website)) return null;
  const add: Additions = { website: null, phone: null, email: null, contact_name: null, contact_role: null };
  let sourceUrl: string | null = null;
  for (const path of CONTACT_PAGES) {
    if ((row.phone || add.phone) && (row.email || add.email)) break;
    const page = await safeFetchPage(new URL(path, row.website).toString());
    if (!page) continue;
    const found = extractContactsFromHtml(page.html);
    if (!(row.phone || add.phone) && found.phones[0]) {
      add.phone = found.phones[0];
      sourceUrl = page.url;
    }
    if (!(row.email || add.email)) {
      const best = pickBestEmail(found.emails, row.website);
      if (best) {
        add.email = best;
        sourceUrl = page.url;
      }
    }
  }
  return hasAny(add) && sourceUrl ? { add, sourceUrl, method: "scraped" } : null;
}

/** Why a Google lookup was refused in a way that will repeat for every school (so we stop asking). */
function quotaRefusal(error: string): string | null {
  const m = /responded (\d{3})/.exec(error);
  const status = m ? Number(m[1]) : 0;
  if (status === 429) return "Google refused the web-search request (quota used up, or web search isn't included for this key).";
  if (status === 403) return "Google refused the web-search request (this key isn't allowed to use web search).";
  if (status === 400 || status === 404) return "Google doesn't support web search on the selected model (try setting GEMINI_ENRICH_MODEL).";
  return null;
}

/**
 * Phase 2: ask Gemini + Google Search to LOCATE a page, then fetch it ourselves and keep a phone/email/
 * name only if it literally appears in the page text. `current` is what the row already has after phase 1.
 */
async function aiOne(
  row: EnrichRow,
  current: { phone: boolean; email: boolean },
  usage: { add: (u: AiUsage | null) => void },
): Promise<{ found: Found | null; stop?: string; note?: string }> {
  const ai = await generatePlatformText({
    task: "outreach_contact_lookup",
    prompt: buildEnrichmentPrompt(row),
    webSearch: true,
    temperature: 0.1,
    model: GEMINI_ENRICH_MODEL,
    maxOutputTokens: 1024,
    timeoutMs: 40_000,
  });
  if (!ai.ok) return { found: null, stop: quotaRefusal(ai.error) ?? undefined, note: ai.error };
  usage.add(ai.usage);

  const parsed = parseEnrichmentResponse(ai.text);
  if (!parsed.ok) return { found: null, note: parsed.error };
  if (!parsed.value.source_url) return { found: null };

  const [source, site] = await Promise.all([
    safeFetchPage(parsed.value.source_url),
    row.website ? Promise.resolve(null) : parsed.value.website ? safeFetchPage(parsed.value.website) : Promise.resolve(null),
  ]);
  if (!source) return { found: null };
  const v = verifyFoundContacts(parsed.value, source.text, site?.text ?? null, row.school_name);
  const add: Additions = { website: null, phone: null, email: null, contact_name: null, contact_role: null };
  if (!current.phone && v.phone) add.phone = v.phone;
  if (!current.email && v.email) add.email = v.email;
  if (!row.website && v.website) add.website = v.website;
  if (!row.contact_name && v.contact_name) {
    add.contact_name = v.contact_name;
    add.contact_role = v.contact_role;
  }
  return hasAny(add) ? { found: { add, sourceUrl: source.url, method: "ai_found" } } : { found: null };
}

/**
 * Fills in missing website/phone/email/head-teacher for up to MAX_ENRICH_BATCH prospects. Found details
 * are stored UNVERIFIED with their source URL; a person must confirm them before promotion.
 * Never overwrites existing values. Sends nothing.
 *
 * Order matters for cost and reliability: every school's own website is read first (in parallel, no
 * AI quota). Only schools still missing a phone or email go to the web-search step, one at a time, and
 * the first quota/permission refusal from Google stops that step for the rest of the batch.
 */
export async function enrichOutboundProspects(
  ids: string[],
): Promise<
  | { error: string }
  | { success: true; enriched: number; notFound: number; failed: number; searchUnavailable?: string; note?: string }
> {
  if (!Array.isArray(ids) || ids.length === 0) return { error: "Choose at least one prospect." };
  if (ids.length > MAX_ENRICH_BATCH) return { error: `Find contacts for at most ${MAX_ENRICH_BATCH} prospects at a time.` };
  if (!ids.every(isUuid)) return { error: "Invalid prospect id." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const { data: rows, error: readErr } = await supabase
    .from("outbound_prospects")
    .select("id, school_name, town_county, school_level, website, phone, email, contact_name, contact_role, status")
    .in("id", ids);
  if (readErr) return { error: readErr.message };
  if (!rows || rows.length === 0) return { error: "Those prospects weren't found." };

  let total: AiUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
  const usage = { add: (u: AiUsage | null) => { total = addUsage(total, u); } };
  const todo = (rows as EnrichRow[]).filter((r) => r.status !== "promoted" && (!r.phone || !r.email));

  const save = async (row: EnrichRow, f: Found): Promise<boolean> => {
    const { error } = await supabase.rpc("admin_set_outbound_prospect_contacts", {
      p_id: row.id,
      p_website: f.add.website,
      p_phone: f.add.phone,
      p_email: f.add.email,
      p_contact_name: f.add.contact_name,
      p_contact_role: f.add.contact_role,
      p_source_url: f.sourceUrl,
      p_method: f.method,
    });
    return !error;
  };

  // Phase 1 (parallel): the schools' own websites.
  const scraped = await Promise.all(todo.map((row) => scrapeOne(row)));
  let enriched = 0;
  let failed = 0;
  const stillMissing: Array<{ row: EnrichRow; phone: boolean; email: boolean }> = [];
  for (let i = 0; i < todo.length; i++) {
    const row = todo[i];
    const f = scraped[i];
    if (f) {
      if (await save(row, f)) enriched++;
      else failed++;
    }
    const phone = Boolean(row.phone || f?.add.phone);
    const email = Boolean(row.email || f?.add.email);
    if (!phone || !email) stillMissing.push({ row, phone, email });
  }

  // Phase 2 (one at a time): web search for what's still missing; stop at the first quota refusal.
  let searchUnavailable: string | undefined;
  let note: string | undefined;
  const alreadyCounted = new Set(todo.filter((_, i) => scraped[i]).map((r) => r.id));
  for (const { row, phone, email } of stillMissing) {
    if (searchUnavailable) break;
    const r = await aiOne(row, { phone, email }, usage);
    if (r.stop) {
      searchUnavailable = r.stop;
      break;
    }
    if (r.note && !note) note = r.note;
    if (r.found) {
      if (await save(row, r.found)) {
        if (!alreadyCounted.has(row.id)) enriched++;
      } else failed++;
    }
  }

  const notFound = Math.max(0, todo.length - enriched - failed);
  void logAdminAction(supabase, "enrich_outbound_prospects", {
    enriched,
    notFound,
    failed,
    search_unavailable: Boolean(searchUnavailable),
    model: GEMINI_ENRICH_MODEL,
    prompt_tokens: total.promptTokens,
    output_tokens: total.outputTokens,
    total_tokens: total.totalTokens,
  });
  revalidatePath(PATH);
  return { success: true, enriched, notFound, failed, searchUnavailable, note };
}

/**
 * Hand-typed contact details (e.g. after phoning the school office). They replace the stored contact
 * fields and count as confirmed by a person. Validation here; the RPC re-checks permission and state.
 */
export async function updateOutboundContacts(id: string, input: ManualContactsInput): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "Invalid prospect id." };
  const parsed = normalizeManualContacts(input);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_update_outbound_prospect_contacts", {
    p_id: id,
    p_website: v.website,
    p_phone: v.phone,
    p_email: v.email,
    p_contact_name: v.contact_name,
    p_contact_role: v.contact_role,
  });
  if (error) return { error: error.message };

  // Which fields were set, never their values: contact details stay out of the audit log.
  void logAdminAction(supabase, "update_outbound_contacts", {
    prospect_id: id,
    has_phone: Boolean(v.phone),
    has_email: Boolean(v.email),
    has_website: Boolean(v.website),
    has_name: Boolean(v.contact_name),
  });
  revalidatePath(PATH);
  return { success: true };
}

export async function confirmOutboundContacts(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "Invalid prospect id." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_confirm_outbound_prospect_contacts", { p_id: id });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "confirm_outbound_contacts", { prospect_id: id });
  revalidatePath(PATH);
  return { success: true };
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

// ---------------------------------------------------------------------------------------------
// Contact log + opt-outs (20261017120000_outbound_contact_log_and_opt_outs.sql). The log is
// manual and self-reported: it records what a rep says they did, never delivery. The database
// refuses unapproved prospects, unusable contacts and opted-out contacts; the UI mirrors that.
// Audit-log detail carries ids, channel and event only, never an address or phone number.
// ---------------------------------------------------------------------------------------------

export type ProspectContactState = {
  success: true;
  blocked: { email: boolean; whatsapp: boolean };
  log: ContactLogRow[];
};

/** Called when a prospect's dialog opens: current opt-out status per channel plus its recent history. */
export async function loadProspectContact(id: string): Promise<{ error: string } | ProspectContactState> {
  if (!isUuid(id)) return { error: "Invalid prospect id." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const { data: prospect, error: pErr } = await supabase
    .from("outbound_prospects")
    .select("email, phone")
    .eq("id", id)
    .maybeSingle();
  if (pErr) return { error: pErr.message };
  if (!prospect) return { error: "Outbound prospect not found." };

  const [emailBlocked, waBlocked, logRes] = await Promise.all([
    prospect.email
      ? supabase.rpc("admin_is_outbound_contact_blocked", { p_channel: "email", p_identifier: prospect.email })
      : Promise.resolve({ data: false, error: null }),
    prospect.phone
      ? supabase.rpc("admin_is_outbound_contact_blocked", { p_channel: "whatsapp", p_identifier: prospect.phone })
      : Promise.resolve({ data: false, error: null }),
    supabase
      .from("outbound_contact_log")
      .select("id, channel, event, created_at, performed_by, note")
      .eq("prospect_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);
  if (emailBlocked.error) return { error: emailBlocked.error.message };
  if (waBlocked.error) return { error: waBlocked.error.message };
  if (logRes.error) return { error: logRes.error.message };

  return {
    success: true,
    blocked: { email: emailBlocked.data === true, whatsapp: waBlocked.data === true },
    log: (logRes.data ?? []) as ContactLogRow[],
  };
}

export async function logOutboundContact(
  prospectId: string,
  channel: string,
  event: string,
  performedBy: string | null,
  note?: string,
): Promise<ActionResult> {
  if (!isUuid(prospectId)) return { error: "Invalid prospect id." };
  if (performedBy !== null && !isUuid(performedBy)) return { error: "Invalid team member." };
  const checked = validateContactInput(channel, event, note);
  if (!checked.ok) return { error: checked.error };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_log_outbound_contact", {
    p_prospect_id: prospectId,
    p_channel: checked.channel,
    p_event: checked.event,
    p_performed_by: performedBy,
    p_note: checked.note,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "log_outbound_contact", {
    prospect_id: prospectId,
    channel: checked.channel,
    event: checked.event,
  });
  revalidatePath(PATH);
  return { success: true };
}

/**
 * Record a STOP / "do not contact" for a prospect's own email address or phone number. The identifier
 * is read from the prospect row on the server (never taken from the browser), so what is blocked is
 * exactly what the drafts would have been sent to.
 */
export async function recordProspectOptOut(
  prospectId: string,
  channel: string,
  reason: string,
): Promise<{ error: string } | { success: true; matched: number }> {
  if (!isUuid(prospectId)) return { error: "Invalid prospect id." };
  if (!isContactChannel(channel)) return { error: "Unknown channel." };
  if (!isOptOutReason(reason)) return { error: "Invalid reason." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const { data: prospect, error: pErr } = await supabase
    .from("outbound_prospects")
    .select("email, phone")
    .eq("id", prospectId)
    .maybeSingle();
  if (pErr) return { error: pErr.message };
  if (!prospect) return { error: "Outbound prospect not found." };

  const identifier = channel === "email" ? prospect.email : prospect.phone;
  if (!identifier) return { error: channel === "email" ? "No email address on file." : "No phone number on file." };

  const { data, error } = await supabase.rpc("admin_record_outbound_opt_out", {
    p_channel: channel,
    p_identifier: identifier,
    p_reason: reason,
    p_note: null,
  });
  if (error) return { error: error.message };

  const matched = typeof data === "number" ? data : 0;
  void logAdminAction(supabase, "record_outbound_opt_out", { prospect_id: prospectId, channel, reason, matched });
  revalidatePath(PATH);
  return { success: true, matched };
}
