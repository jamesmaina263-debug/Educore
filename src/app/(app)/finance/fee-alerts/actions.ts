"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

// ---------------------------------------------------------------------------
// Fee-threshold alerts (Finance > Fee Alerts)
//
// check_fee_thresholds() only ever creates draft rows -- nothing here sends a
// message until a Finance user explicitly calls approveAndSendAction below.
// AI involvement (polishDraftWithAIAction) only ever rewrites draft_body for
// review; it never changes status and is never called on the send path.
// ---------------------------------------------------------------------------

export async function checkFeeThresholdsAction(): Promise<{ error: string } | { success: true; created: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_fee_thresholds");
  if (error) return { error: error.message };
  revalidatePath("/finance/fee-alerts");
  return { success: true, created: (data as number) ?? 0 };
}

export async function updateDraftBodyAction(alertId: string, body: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("fee_threshold_alerts")
    .update({ draft_body: body })
    .eq("id", alertId)
    .in("status", ["draft", "approved"]);
  if (error) return { error: error.message };
  revalidatePath("/finance/fee-alerts");
  return { success: true };
}

export async function dismissAlertAction(alertId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase.from("school_users").select("id").eq("auth_user_id", user?.id).maybeSingle();

  const { error } = await supabase
    .from("fee_threshold_alerts")
    .update({
      status: "dismissed",
      dismissed_by: schoolUser?.id ?? null,
      dismissed_at: new Date().toISOString(),
      dismiss_reason: reason || null,
    })
    .eq("id", alertId)
    .in("status", ["draft", "approved"]);
  if (error) return { error: error.message };
  revalidatePath("/finance/fee-alerts");
  return { success: true };
}

export async function approveAndSendAction(alertId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_fee_threshold_alert", { p_alert_id: alertId });
  if (error) return { error: error.message };
  revalidatePath("/finance/fee-alerts");
  // false = the guardian had neither a phone nor an email on file, so nothing
  // was actually queued -- the alert is marked dismissed (not sent) server-side,
  // but the person who clicked the button still needs to know why.
  if (data === false) {
    return { error: "Couldn't send — this guardian has no phone or email on file. The alert has been marked as needing attention instead of sent." };
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// AI polish (Google Gemini, free tier) -- rewrites the *tone* of an existing
// draft only. The prompt explicitly forbids changing any name or figure
// already in the message, so the model can only rephrase, never invent a
// balance or a name. Never touches status -- a Finance user must still
// explicitly approve-and-send afterwards. Same never-reaches-a-parent-
// unreviewed principle as report-card AI-drafted comments.
// ---------------------------------------------------------------------------

export async function polishDraftWithAIAction(alertId: string): Promise<ActionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "AI drafting isn't configured yet -- GEMINI_API_KEY is missing from the server environment." };
  }

  const supabase = await createClient();
  const { data: alert, error: fetchError } = await supabase
    .from("fee_threshold_alerts")
    .select("draft_body, status")
    .eq("id", alertId)
    .maybeSingle();
  if (fetchError || !alert) return { error: fetchError?.message ?? "Alert not found." };
  if (alert.status !== "draft" && alert.status !== "approved") {
    return { error: "This alert has already been sent or dismissed." };
  }

  const prompt = `You are helping a Kenyan school's Finance office soften the tone of a fee-arrears reminder before it is reviewed and sent to a parent.

Current message:
"${alert.draft_body}"

Rewrite it to sound warmer and more considerate, while staying brief (2-4 sentences) and professional. Do NOT change, remove, or add any name, amount, or figure that appears in the current message -- only rephrase the wording around them. Do not invent any new facts. Output only the rewritten message, no preamble, no quotation marks.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 200 },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      return { error: `AI drafting failed (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    const draft: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!draft) return { error: "AI drafting returned no text." };

    const { error } = await supabase
      .from("fee_threshold_alerts")
      .update({ draft_body: draft.trim(), ai_drafted: true })
      .eq("id", alertId);
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reach the AI drafting service." };
  }

  revalidatePath("/finance/fee-alerts");
  return { success: true };
}
