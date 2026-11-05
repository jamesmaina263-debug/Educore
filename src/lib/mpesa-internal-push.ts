// Server-side only. Dispatches an already-created STK request through the mpesa-stk-push edge function's INTERNAL
// mode (WP 1.3b), authenticated with the shared DISPATCH_SECRET in x-dispatch-secret: the same server-to-server
// path /api/cron/mpesa-stale-pending uses for mpesa-stk-query. The service key as a Bearer token cannot be used
// here (the gateway 401s an sb_secret_ key). The edge function only dispatches requests approved by
// mpesa_stk_internal_dispatch_allowed() (Pay by Link attempts, later bot requests).

export type InternalPushResult = { ok: true } | { ok: false; reason: "not_configured" | "rejected" | "network"; status?: number };

export async function dispatchInternalStkPush(requestId: string): Promise<InternalPushResult> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dispatchSecret = process.env.DISPATCH_SECRET;
  if (!baseUrl || !dispatchSecret) return { ok: false, reason: "not_configured" };
  try {
    const res = await fetch(`${baseUrl}/functions/v1/mpesa-stk-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dispatch-secret": dispatchSecret },
      body: JSON.stringify({ request_id: requestId }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    return res.ok ? { ok: true } : { ok: false, reason: "rejected", status: res.status };
  } catch {
    return { ok: false, reason: "network" };
  }
}
