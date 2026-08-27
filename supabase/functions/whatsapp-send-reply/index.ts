import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getWhatsAppProvider } from "../_shared/whatsapp/index.ts";

// Called from the Communication > WhatsApp inbox UI when a staff member sends a reply. Mirrors
// send-communication's shape: a user-scoped client only to authenticate/authorize the caller, then
// the actual write (and the outbound Twilio call Postgres can't make on its own) goes through the
// service role, same "no direct client insert on whatsapp_messages" reasoning as the migration.
Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header." }, 401);

    const { conversation_id, message } = await req.json();
    if (typeof conversation_id !== "string" || typeof message !== "string" || !message.trim()) {
      return json({ error: "conversation_id and a non-empty message are required." }, 400);
    }

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const [{ data: canWrite }, { data: schoolId }] = await Promise.all([
      userClient.rpc("auth_has_permission", { p_permission_key: "communication.write" }),
      userClient.rpc("auth_school_id"),
    ]);
    if (!canWrite || !schoolId) return json({ error: "Not authorized to reply to WhatsApp conversations." }, 403);

    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not signed in." }, 401);

    const { data: staffRow } = await userClient.from("school_users").select("id").eq("auth_user_id", user.id).maybeSingle();
    if (!staffRow) return json({ error: "Could not resolve your staff record." }, 403);

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: convo, error: convoError } = await serviceClient
      .from("whatsapp_conversations")
      .select("id, school_id, phone_number")
      .eq("id", conversation_id)
      .eq("school_id", schoolId) // scoped by the caller's own school, not just any conversation_id they can guess
      .maybeSingle();
    if (convoError || !convo) return json({ error: "Conversation not found." }, 404);

    let sendStatus: "sent" | "failed" = "sent";
    let providerError: string | null = null;
    try {
      await getWhatsAppProvider().send(convo.phone_number, message);
    } catch (err) {
      sendStatus = "failed";
      providerError = err instanceof Error ? err.message : String(err);
    }

    await serviceClient.from("whatsapp_messages").insert({
      conversation_id: convo.id,
      school_id: convo.school_id,
      direction: "outbound",
      sender_type: "staff",
      sender_staff_id: staffRow.id,
      body: message,
      status: sendStatus,
      provider_response: providerError,
    });

    // Runs under the caller's own session (userClient), not the service role -- staff already
    // has direct update rights on whatsapp_conversations (communication.write, see the
    // migration's RLS policy), and doing it this way means the existing system-wide audit
    // trigger (audit_row_change, attached to whatsapp_conversations) correctly attributes this
    // change to the staff member via auth.uid() instead of logging a null actor. Only the
    // message insert below needs the service role -- it has to reach Twilio first, which
    // Postgres can't do on its own.
    const { error: updateError } = await userClient
      .from("whatsapp_conversations")
      .update({
        status: "staff_handling",
        assigned_to: staffRow.id,
        unread_count: 0,
        escalation_reason: null, // a human is now handling it -- whatever triggered escalation is resolved
        last_message_at: new Date().toISOString(),
        last_message_preview: message.slice(0, 140),
      })
      .eq("id", convo.id);
    if (updateError) return json({ error: updateError.message }, 500);

    if (sendStatus === "failed") return json({ error: `Message logged, but sending failed: ${providerError}` }, 502);
    return json({ success: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected error." }, 500);
  }
});
