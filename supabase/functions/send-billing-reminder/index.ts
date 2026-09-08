import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getEmailProvider } from "../_shared/email/index.ts";
import { sendSecurityAlert } from "../_shared/securityAlert.ts";

// Dunning follow-up: called from /admin/billing's overdue-invoice list ("Send reminder").
// Same auth pattern as zoho-mail-monitor/send-communication -- verify_jwt is false for this
// function (see config.toml), with the actual check done here against the caller's own JWT,
// not the service role. The service-role client below is only used after that check passes,
// to read the school's owner contact (RLS would otherwise scope that to the owner's own
// school) and to record reminder_sent_at.
Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header." }, 401);

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: isSuperAdmin } = await userClient.rpc("auth_is_super_admin");
    if (isSuperAdmin !== true) return json({ error: "Not authorized." }, 403);

    let body: { invoice_id?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    if (!body.invoice_id) return json({ error: "invoice_id is required" }, 400);

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: invoice, error: invoiceError } = await serviceClient
      .from("platform_invoices")
      .select("id, school_id, amount_kes, due_at, period_start, period_end, status")
      .eq("id", body.invoice_id)
      .maybeSingle();
    if (invoiceError || !invoice) return json({ error: "Invoice not found." }, 404);

    const { data: school } = await serviceClient.from("schools").select("name").eq("id", invoice.school_id).maybeSingle();

    const { data: ownerRole } = await serviceClient.from("roles").select("id").eq("name", "school_owner").maybeSingle();
    const { data: owner } = ownerRole
      ? await serviceClient
          .from("school_users")
          .select("email, full_name")
          .eq("school_id", invoice.school_id)
          .eq("role_id", ownerRole.id)
          .eq("status", "active")
          .not("email", "is", null)
          .limit(1)
          .maybeSingle()
      : { data: null };

    if (!owner?.email) {
      return json({ error: "No active school owner with an email on file for this school." }, 422);
    }

    const daysOverdue = Math.max(0, Math.floor((Date.now() - new Date(invoice.due_at).getTime()) / 86_400_000));
    const schoolName = school?.name ?? "your school";
    const subject = `Overdue invoice for ${schoolName} -- ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} past due`;
    const body_html = [
      `<p>Hi ${owner.full_name ?? "there"},</p>`,
      `<p>This is a reminder that ${schoolName}'s EduCore subscription invoice for `,
      `${invoice.period_start} to ${invoice.period_end} (KES ${invoice.amount_kes}) `,
      `is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue.</p>`,
      `<p>Please arrange payment to avoid the account being suspended. Reach out if you have already paid or need to discuss this.</p>`,
    ].join("");

    const emailProvider = getEmailProvider();
    await emailProvider.send(owner.email, subject, body_html);

    const { error: updateError } = await serviceClient
      .from("platform_invoices")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", invoice.id);
    if (updateError) console.error("send-billing-reminder: failed to record reminder_sent_at", updateError);

    return json({ success: true, sent_to: owner.email });
  } catch (err) {
    console.error("send-billing-reminder: unexpected error", err);
    void sendSecurityAlert("Billing reminder send failed unexpectedly", {
      error: err instanceof Error ? err.message : String(err),
    });
    return json({ error: "Unexpected error sending the reminder." }, 500);
  }
});
