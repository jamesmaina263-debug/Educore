import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getSmsProvider } from "../_shared/sms/index.ts";
import { getEmailProvider } from "../_shared/email/index.ts";
import { getWhatsAppProvider } from "../_shared/whatsapp/index.ts";

// Dispatches queued notification_logs rows for the caller's school. Called right after
// queue_communication() for a manual send, and also doubles as the delivery mechanism for
// system-queued rows (the 3-consecutive-absence alert trigger) — those get sent the next time any
// staff member with communication.write visits the Communication page, rather than instantly via a
// background job. A real simplification for v1: no pg_cron/pg_net wiring yet, flagged rather than
// silently built as if it were instant. The row itself (and the business rule that queued it) is
// still fully correct regardless of when dispatch happens.
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

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // A caller who only has health.write (the Nurse, typically) can dispatch her own
    // health-sourced queued messages and nothing else — never the whole school's pending
    // Communication queue, which she has no visibility into and shouldn't be able to trigger.
    // A caller with the full communication.write permission dispatches everything queued, as
    // before (health-sourced rows included — they're real queued messages like any other).
    let query = serviceClient
      .from("notification_logs")
      .select("id, channel, recipient_phone, recipient_email, subject, body, attachment_storage_path, attachment_filename")
      .eq("school_id", schoolId)
      .eq("status", "queued")
      .limit(100); // one batch per call; a large backlog just needs the page visited again

    if (!canWrite && canWriteHealth) {
      query = query.eq("source_module", "health");
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
