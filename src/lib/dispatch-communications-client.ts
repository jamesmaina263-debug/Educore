import "server-only";

// Server-to-server trigger for the send-communication Edge Function that does NOT depend on
// how Supabase's gateway treats an sb_secret_... key in the Authorization header (that path
// returned a gateway-level 401 on every call from 27 Sep 2026 onward while the same key still
// worked against REST). Authenticates with a dedicated shared secret in x-dispatch-secret,
// checked inside the function with a constant-time compare.
//
// Returns the same { data, error } shape as supabase.functions.invoke(), including
// error.context.status, so withTransientAuthRetry() and existing callers work unchanged.

type DispatchData = { total?: number; sent?: number; failed?: number } & Record<string, unknown>;
type DispatchError = { message: string; context: { status: number } };
export type DispatchResult = { data: DispatchData | null; error: DispatchError | null };

const fail = (message: string, status: number): DispatchResult => ({
  data: null,
  error: { message, context: { status } },
});

export async function dispatchQueuedCommunications(): Promise<DispatchResult> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.DISPATCH_SECRET;
  if (!baseUrl || !secret) {
    return fail("DISPATCH_SECRET or NEXT_PUBLIC_SUPABASE_URL is not configured.", 500);
  }

  try {
    const res = await fetch(`${baseUrl}/functions/v1/send-communication`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dispatch-secret": secret },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(50_000),
    });
    const body = (await res.json().catch(() => null)) as (DispatchData & { error?: string }) | null;
    if (!res.ok) {
      return fail(body?.error ?? `send-communication responded ${res.status}`, res.status);
    }
    return { data: body, error: null };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "send-communication request failed.", 502);
  }
}
