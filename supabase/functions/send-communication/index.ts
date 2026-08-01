import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getSmsProvider } from "../_shared/sms/index.ts";

// Dispatches every status='queued' row for the caller's school. Called right after
// queue_communication() for a manual send, and also doubles as the delivery mechanism for
// system-queued rows (the 3-consecutive-absence alert trigger) — those get sent the next time any
// staff member with communication.write visits the Communication page, rather than instantly via a
// background job. A real simplification for v1: no pg_cron/pg_net wiring yet, flagged rather than
// silently built as if it were instant. The row itself (and the business rule that queued it) is
// still fully correct regardless of when dispatch happens.
Deno.serve(async (req) => {
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

    const [{ data: canWrite }, { data: schoolId }] = await Promise.all([
      userClient.rpc("auth_has_permission", { p_permission_key: "communication.write" }),
      userClient.rpc("auth_school_id"),
    ]);

    if (!canWrite || !schoolId) {
      return json({ error: "Not authorized to dispatch communications." }, 403);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: queued, error: fetchError } = await serviceClient
      .from("notification_logs")
      .select("id, recipient_phone, body")
      .eq("school_id", schoolId)
      .eq("status", "queued")
      .limit(100); // one batch per call; a large backlog just needs the page visited again

    if (fetchError) {
      return json({ error: fetchError.message }, 500);
    }

    const provider = getSmsProvider();
    let sent = 0;
    let failed = 0;

    for (const row of queued ?? []) {
      try {
        await provider.send(row.recipient_phone, row.body);
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
