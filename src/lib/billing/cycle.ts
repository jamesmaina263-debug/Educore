import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSecurityAlert } from "@/lib/security-alert";
import { withTransientAuthRetry } from "@/lib/supabase/retry-transient-auth";
import { emailInvoiceFromCron } from "./send-invoice";

// The scheduled part of invoicing, called from the existing daily /api/cron/billing route.
// Everything that decides WHICH invoices exist lives in SQL (run_platform_billing_cycle); this
// file only orchestrates and, when the administrator has enabled auto_send, emails them.

const MAX_EMAILS_PER_RUN = 25; // keeps the cron comfortably inside the function time limit
const RETRY_WINDOW_DAYS = 7; // unsent auto invoices are retried daily for a week, then left for a human

export type ScheduledInvoicingResult = {
  ran: boolean;
  reason?: string;
  created: number;
  statusOnCreate?: string;
  skipped: number;
  emailed: number;
  emailFailures: { invoice_number: string; error: string }[];
  errors: { school_name?: string; error: string }[];
};

type CycleJson = {
  ran?: boolean;
  reason?: string;
  status_on_create?: string;
  created?: { invoice_id: string; invoice_number: string; school_name: string }[];
  skipped?: unknown[];
  errors?: { school_name?: string; error: string }[];
};

export async function runScheduledInvoicing(adminClient: SupabaseClient): Promise<ScheduledInvoicingResult> {
  const result: ScheduledInvoicingResult = { ran: false, created: 0, skipped: 0, emailed: 0, emailFailures: [], errors: [] };

  const { data, error } = await withTransientAuthRetry(() =>
    adminClient.rpc("run_platform_billing_cycle", { p_dry_run: false, p_trigger: "cron" }),
  );
  if (error) {
    result.errors.push({ error: error.message });
    void sendSecurityAlert("Automated invoicing failed (run_platform_billing_cycle)", { error: error.message });
    return result;
  }
  const cycle = (data ?? {}) as CycleJson;
  if (!cycle.ran) return { ...result, reason: cycle.reason ?? "not_run" };

  result.ran = true;
  result.created = cycle.created?.length ?? 0;
  result.skipped = cycle.skipped?.length ?? 0;
  result.statusOnCreate = cycle.status_on_create;
  result.errors = cycle.errors ?? [];

  // Emailing is a separate, opt-in switch: auto_send requires auto_issue (enforced in SQL).
  const { data: settings } = await adminClient.from("platform_billing_settings").select("auto_send").maybeSingle();
  if (settings?.auto_send === true) {
    const since = new Date(Date.now() - RETRY_WINDOW_DAYS * 86_400_000).toISOString();
    const { data: pending } = await adminClient
      .from("platform_invoices")
      .select("id, invoice_number")
      .eq("source", "auto")
      .eq("status", "issued")
      .is("sent_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(MAX_EMAILS_PER_RUN);
    for (const inv of pending ?? []) {
      const sent = await emailInvoiceFromCron({ client: adminClient, invoiceId: inv.id });
      if (sent.ok) result.emailed += 1;
      else result.emailFailures.push({ invoice_number: inv.invoice_number, error: sent.error });
    }
  }

  if (result.errors.length > 0 || result.emailFailures.length > 0) {
    void sendSecurityAlert("Automated invoicing finished with problems", {
      errors: JSON.stringify(result.errors).slice(0, 800),
      email_failures: JSON.stringify(result.emailFailures).slice(0, 800),
    });
  }
  return result;
}
