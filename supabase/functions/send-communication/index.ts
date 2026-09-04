import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getSmsProvider } from "../_shared/sms/index.ts";
import { getEmailProvider } from "../_shared/email/index.ts";
import { getWhatsAppProvider } from "../_shared/whatsapp/index.ts";

// Dispatches queued notification_logs rows. Called right after queue_communication() for a
// manual send, and also doubles as the delivery mechanism for system-queued rows (the
// 3-consecutive-absence alert trigger, online-admission confirmations).
//
// Two callers, two modes:
// - A real user session (Authorization: Bearer <user JWT>): scoped to that user's own school,
//   gated on communication.write / health.write exactly as before.
// - The service role key as the bearer token (Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>):
//   trusted system caller — used by admin.functions.invoke() from server-side code that has no
//   user session to hand (e.g. a public admissions form) and by the /api/cron/dispatch-communications
//   Vercel Cron sweep. Processes queued rows across ALL schools rather than one, since there's no
//   user to scope to. Previously this path (see apply/[slug]/actions.ts's "best-effort" invoke)
//   silently 403'd — auth_school_id()/auth_has_permission() both resolve off auth.uid(), which a
//   service-role JWT has none of — so system-queued rows always fell back to "next staff member who
//   opens Communication", which for a same-day admissions confirmation could be days. The service-role
//   check below is what actually closes that gap.
//
// Also dispatches health-sourced alerts (queue_health_alert, health.write) — a health.write-only
// caller is scoped to source_module='health' rows only, see below.
Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header." }, 401);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

    // A caller presenting the service role key itself as the bearer token is trusted by
    // definition (anyone with that key already has full DB access) — used by
    // admin.functions.invoke() calls from server-side code with no user session, and by the
    // dispatch-communications cron sweep. Everyone else must be a real user JWT, checked below.
    const isServiceRoleCaller = authHeader === `Bearer ${serviceRoleKey}`;

    let query = serviceClient
      .from("notification_logs")
      .select("id, channel, recipient_phone, recipient_email, subject, body, attachment_storage_path, attachment_filename")
      .eq("status", "queued")
      .limit(100); // one page per call; cron loops, a user just gets the page visited again

    if (isServiceRoleCaller) {
      // No user to scope to — sweep queued rows across every school. Nothing school-specific is
      // returned to the caller (aggregate counts only, server-to-server), so this doesn't reopen
      // tenant isolation the way returning row data would.
    } else {
      // User-scoped client: only used to verify who's calling and which school they belong to.
      // notification_logs has no client-facing UPDATE policy by design (status transitions are a
      // system concern, not a user-editable field), so the actual dispatch below uses the service
      // role deliberately — this permission check is what stands in for that RLS gate.
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );

      const [{ data: canWrite }, { data: canWriteHealth }, { data: schoolId }] = await Promise.all([
        userClient.rpc("auth_has_permission", { p_permission_key: "communication.write" }),
        userClient.rpc("auth_has_permission", { p_permission_key: "health.write" }),
        userClient.rpc("auth_school_id"),
      ]);

      if ((!canWrite && !canWriteHealth) || !schoolId) {
        return json({ error: "Not authorized to dispatch communications." }, 403);
      }

      query = query.eq("school_id", schoolId);

      // A caller who only has health.write (the Nurse, typically) can dispatch her own
      // health-sourced queued messages and nothing else — never the whole school's pending
      // Communication queue, which she has no visibility into and shouldn't be able to trigger.
      // A caller with the full communication.write permission dispatches everything queued, as
      // before (health-sourced rows included — they're real queued messages like any other).
      if (!canWrite && canWriteHealth) {
        query = query.eq("source_module", "health");
      }
    }

    const { data: queued, error: fetchError } = await query;

    if (fetchError) {
      return json({ error: fetchError.message }, 500);
    }

    const smsProvider = getSmsProvider();
    const emailProvider = getEmailProvider();
    const whatsappProvider = getWhatsAppProvider();
    let sent = 0;
    let failed = 0;

    for (const row of queued ?? []) {
      try {
        if (row.channel === "email") {
          let attachments: { filename: string; contentBase64: string }[] | undefined;
          if (row.attachment_storage_path) {
            const { data: fileBlob, error: downloadError } = await serviceClient.storage
              .from("application-documents")
              .download(row.attachment_storage_path);
            if (downloadError || !fileBlob) {
              throw new Error(`Could not load attachment: ${downloadError?.message ?? "not found"}`);
            }
            const bytes = new Uint8Array(await fileBlob.arrayBuffer());
            let binary = "";
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            attachments = [{ filename: row.attachment_filename ?? "attachment", contentBase64: btoa(binary) }];
          }
          await emailProvider.send(row.recipient_email!, row.subject ?? "", row.body, attachments);
        } else if (row.channel === "whatsapp") {
          await whatsappProvider.send(row.recipient_phone!, row.body);
        } else {
          await smsProvider.send(row.recipient_phone!, row.body);
        }
        await serviceClient.from("notification_logs").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", row.id);
        sent++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await serviceClient
          .from("notification_logs")
          .update({ status: "failed", provider_response: message.slice(0, 500), updated_at: new Date().toISOString() })
          .eq("id", row.id);
        failed++;
      }
    }

    return json({ success: true, sent, failed, total: (queued ?? []).length });
  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected error." }, 500);
  }
});
