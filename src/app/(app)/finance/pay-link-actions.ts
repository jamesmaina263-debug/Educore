"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { buildPayLinkUrl } from "@/lib/pay-link";

// Staff action: create a Pay by Link for one invoice. Authorization, the feature flag, limits and
// tenant checks all live in create_pay_link() (finance.write + flag + own school). The token is
// returned once and is not stored anywhere in plain text.
export async function createPayLinkAction(input: {
  studentId: string;
  invoiceId?: string;
  amount: number;
}): Promise<{ error: string } | { success: true; url: string; expiresAt: string }> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const { data, error } = await supabase.rpc("create_pay_link", {
    p_student_id: input.studentId,
    p_amount: input.amount,
    p_invoice_id: input.invoiceId ?? null,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row?.token) return { error: error?.message ?? "Could not create the pay link." };

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return { error: "Could not work out the site address." };
  const proto = h.get("x-forwarded-proto") ?? "https";
  return { success: true, url: buildPayLinkUrl(`${proto}://${host}`, row.token as string), expiresAt: row.expires_at as string };
}
