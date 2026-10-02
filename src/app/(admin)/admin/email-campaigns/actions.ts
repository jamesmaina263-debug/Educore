"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";

export interface AudienceRow {
  school_id: string;
  school_name: string;
  school_status: string;
  owner_name: string | null;
  email: string;
  suppressed: boolean;
}

export interface CampaignHistoryRow {
  id: string;
  subject: string;
  created_at: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
}

type ErrorResult = { error: string };

const MAX_SUBJECT = 200;
const MAX_BODY = 10000;

function validate(subject: string, body: string): string | null {
  if (!subject.trim()) return "Subject is required.";
  if (!body.trim()) return "Message is required.";
  if (subject.length > MAX_SUBJECT) return `Subject must be ${MAX_SUBJECT} characters or fewer.`;
  if (body.length > MAX_BODY) return `Message must be ${MAX_BODY} characters or fewer.`;
  return null;
}

// Authorization lives in the database: every RPC below raises unless auth_is_super_admin(), and
// the Edge Function re-checks it. These actions deliberately do not trust the page-level redirect.

export async function sendCampaignTestEmail(subject: string, body: string): Promise<ErrorResult | { success: true; sentTo: string }> {
  const invalid = validate(subject, body);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const { data, error } = await supabase.functions.invoke("send-owner-campaign", {
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: { test: true, subject: subject.trim(), body: body.trim() },
  });
  if (error) return { error: await extractEdgeFunctionError(error, "Failed to send the test email.") };
  return { success: true, sentTo: String(data?.sent_to ?? "your login email") };
}

// Snapshots the recipients and creates the campaign (nothing is sent yet). The UI then calls
// sendCampaignBatch repeatedly, so progress is visible and a closed tab can be resumed.
export async function createOwnerCampaign(
  subject: string,
  body: string,
  excludedEmails: string[],
): Promise<ErrorResult | { success: true; campaignId: string }> {
  const invalid = validate(subject, body);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("create_owner_email_campaign", {
    p_subject: subject.trim(),
    p_body: body.trim(),
    p_excluded_emails: excludedEmails,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "email_campaign_created", { campaign_id: data, subject: subject.trim() });
  revalidatePath("/admin/email-campaigns");
  return { success: true, campaignId: data as string };
}

export async function sendCampaignBatch(
  campaignId: string,
): Promise<ErrorResult | { success: true; sent: number; failed: number; remaining: number }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const { data, error } = await supabase.functions.invoke("send-owner-campaign", {
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: { campaign_id: campaignId },
  });
  if (error) return { error: await extractEdgeFunctionError(error, "Failed to send this batch.") };

  revalidatePath("/admin/email-campaigns");
  return { success: true, sent: data.sent ?? 0, failed: data.failed ?? 0, remaining: data.remaining ?? 0 };
}
