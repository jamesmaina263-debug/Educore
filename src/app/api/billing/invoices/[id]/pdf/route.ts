import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildInvoicePdf } from "@/lib/billing/invoice-pdf";
import { INVOICE_COLUMNS, invoicePdfFileName, toInvoiceRecord } from "@/lib/billing/invoice-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/billing/invoices/:id/pdf            -> download (audited as "downloaded")
// GET /api/billing/invoices/:id/pdf?inline=1   -> open in the browser (not counted as a download)
//
// Runs as the signed-in user, NOT the service role: row-level security decides what exists. A school
// owner can only ever load their own school's non-draft invoices; any other id (another school's
// invoice, a draft, a random uuid) returns the same 404, so ids cannot be probed.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase.from("platform_invoices").select(INVOICE_COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const invoice = toInvoiceRecord(data as unknown as Record<string, unknown>);

  // A draft is only visible to platform staff (RLS). Show it with the payment details configured
  // right now, so the reviewer sees exactly what issuing it would produce.
  if (invoice.status === "draft") {
    const { data: settings } = await supabase
      .from("platform_billing_settings")
      .select("payment_instructions, invoice_footer_note")
      .maybeSingle();
    if (settings) {
      invoice.payment_instructions = {
        ...((settings.payment_instructions as Record<string, string>) ?? {}),
        footer_note: settings.invoice_footer_note as string,
      };
    }
  }

  let pdf: Uint8Array;
  try {
    pdf = buildInvoicePdf(invoice);
  } catch (e) {
    console.error("invoice pdf: generation failed", id, e);
    return NextResponse.json({ error: "Could not generate the invoice PDF." }, { status: 500 });
  }

  const inline = new URL(request.url).searchParams.get("inline") === "1";
  if (!inline) {
    // Awaited: a floating promise can be cut off when the serverless response is sent.
    const { error: auditError } = await supabase.rpc("record_platform_invoice_download", { p_invoice_id: id });
    if (auditError) console.error("invoice pdf: failed to record download", id, auditError.message);
  }

  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${invoicePdfFileName(invoice)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
