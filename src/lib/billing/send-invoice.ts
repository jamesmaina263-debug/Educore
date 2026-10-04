import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";
import { buildInvoicePdf } from "./invoice-pdf";
import { INVOICE_COLUMNS, toInvoiceRecord } from "./invoice-types";

// Emails an invoice PDF through the send-platform-invoice Edge Function. The PDF is rendered here
// (the only place the invoice layout lives) and handed to the function as base64; the function owns
// recipient resolution, the real-provider check and the "mark as sent only after it was sent" rule.

export type SendInvoiceResult = { ok: true; sentTo: string; warning?: string } | { ok: false; error: string };

type Common = { client: SupabaseClient; invoiceId: string };

/** Administrator clicking "Send" / "Resend": authenticated with their own session. */
export async function emailInvoiceAsAdmin(args: Common & { to?: string; resend?: boolean }): Promise<SendInvoiceResult> {
  const pdf = await renderInvoiceBase64(args.client, args.invoiceId);
  if (!pdf.ok) return pdf;
  const {
    data: { session },
  } = await args.client.auth.getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const { data, error } = await args.client.functions.invoke("send-platform-invoice", {
    body: { invoice_id: args.invoiceId, pdf_base64: pdf.base64, to: args.to || undefined, resend: args.resend === true },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) return { ok: false, error: await extractEdgeFunctionError(error, "Failed to send the invoice.") };
  if (data?.error) return { ok: false, error: data.error as string };
  return { ok: true, sentTo: String(data?.sent_to ?? ""), warning: data?.warning as string | undefined };
}

/** Scheduled run (auto_send): authenticated with the shared dispatch secret, like send-communication. */
export async function emailInvoiceFromCron(args: Common): Promise<SendInvoiceResult> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.DISPATCH_SECRET;
  if (!baseUrl || !secret) return { ok: false, error: "DISPATCH_SECRET or NEXT_PUBLIC_SUPABASE_URL is not configured." };
  const pdf = await renderInvoiceBase64(args.client, args.invoiceId);
  if (!pdf.ok) return pdf;
  try {
    const res = await fetch(`${baseUrl}/functions/v1/send-platform-invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dispatch-secret": secret },
      body: JSON.stringify({ invoice_id: args.invoiceId, pdf_base64: pdf.base64 }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    const body = (await res.json().catch(() => null)) as { sent_to?: string; error?: string; warning?: string } | null;
    if (!res.ok) return { ok: false, error: body?.error ?? `send-platform-invoice responded ${res.status}` };
    return { ok: true, sentTo: body?.sent_to ?? "", warning: body?.warning };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send-platform-invoice request failed." };
  }
}

async function renderInvoiceBase64(client: SupabaseClient, invoiceId: string): Promise<{ ok: true; base64: string } | { ok: false; error: string }> {
  const { data, error } = await client.from("platform_invoices").select(INVOICE_COLUMNS).eq("id", invoiceId).maybeSingle();
  if (error || !data) return { ok: false, error: "Invoice not found." };
  const inv = toInvoiceRecord(data as unknown as Record<string, unknown>);
  if (inv.status === "draft" || inv.status === "cancelled") return { ok: false, error: `A ${inv.status} invoice cannot be emailed.` };
  return { ok: true, base64: Buffer.from(buildInvoicePdf(inv)).toString("base64") };
}
