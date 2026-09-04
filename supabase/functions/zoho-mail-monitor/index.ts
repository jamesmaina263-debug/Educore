import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { ZohoMailClient } from "../_shared/zoho-monitor/zohoOAuthClient.ts";

// Read-only bridge between the Admin Console (Next.js, running on Vercel) and the
// Zoho Mail API. Exists because the ZOHO_* credentials live in Supabase secrets, not
// Vercel env vars -- this function is the only thing that ever sees them. Super-admin
// gated the same way every other /admin page is (auth_is_super_admin() via the
// caller's own JWT), not the service role -- there is deliberately no path here that
// bypasses that check.
//
// Query params:
//   ?action=folders
//   ?action=messages&folderId=...&start=1&limit=50
//   ?action=content&folderId=...&messageId=...
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

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: isSuperAdmin } = await userClient.rpc("auth_is_super_admin");
    if (isSuperAdmin !== true) {
      return json({ error: "Not authorized." }, 403);
    }

    const clientId = Deno.env.get("ZOHO_CLIENT_ID");
    const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");
    const refreshToken = Deno.env.get("ZOHO_REFRESH_TOKEN");
    const accountId = Deno.env.get("ZOHO_ACCOUNT_ID");
    const fromAddress = Deno.env.get("ZOHO_FROM_ADDRESS");

    if (!clientId || !clientSecret || !refreshToken || !accountId || !fromAddress) {
      return json({ error: "Zoho Mail monitoring is not configured (missing ZOHO_* secrets)." }, 503);
    }

    const zoho = new ZohoMailClient(clientId, clientSecret, refreshToken, accountId, fromAddress);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "folders") {
      const folders = await zoho.listFolders();
      return json({ folders });
    }

    if (action === "messages") {
      const folderId = url.searchParams.get("folderId") ?? undefined;
      const start = url.searchParams.get("start");
      const limit = url.searchParams.get("limit");
      const messages = await zoho.listMessages({
        folderId,
        start: start ? Number(start) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return json({ messages });
    }

    if (action === "content") {
      const folderId = url.searchParams.get("folderId");
      const messageId = url.searchParams.get("messageId");
      if (!folderId || !messageId) {
        return json({ error: "folderId and messageId are required." }, 400);
      }
      const content = await zoho.getMessageContent(folderId, messageId);
      return json({ content });
    }

    return json({ error: "Unknown or missing action. Use folders, messages, or content." }, 400);
  } catch (err) {
    console.error("[zoho-mail-monitor] error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
