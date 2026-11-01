import type { createClient } from "@/lib/supabase/server";
import { failedSinceIso, staleCutoffIso } from "@/lib/c2b-attention";

export interface FailedEventRow {
  id: string;
  externalId: string;
  amount: number;
  accountReference: string | null;
  at: string;
}

export interface C2bAttention {
  failedCount: number;
  failed: FailedEventRow[];
  staleDeferred: number;
}

const NONE: C2bAttention = { failedCount: 0, failed: [], staleDeferred: 0 };

/**
 * Paybill events that need a person: failed ones from the last 30 days and ones parked for over an
 * hour. Reads through the caller's own session, so RLS limits it to their school. Any error returns
 * "nothing" (the page still renders; this is a convenience banner, not the source of truth).
 */
export async function loadC2bAttention(supabase: Awaited<ReturnType<typeof createClient>>): Promise<C2bAttention> {
  try {
    const now = new Date();
    const [failedRes, staleRes] = await Promise.all([
      supabase
        .from("inbound_payment_events")
        .select("id, external_id, amount, account_reference, created_at", { count: "exact" })
        .eq("outcome", "failed")
        .gte("created_at", failedSinceIso(now))
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("inbound_payment_events")
        .select("id", { count: "exact", head: true })
        .eq("outcome", "deferred_to_stk")
        .lt("created_at", staleCutoffIso(now)),
    ]);
    if (failedRes.error || staleRes.error) return NONE;
    return {
      failedCount: failedRes.count ?? 0,
      failed: (failedRes.data ?? []).map((r) => ({
        id: r.id as string,
        externalId: r.external_id as string,
        amount: Number(r.amount),
        accountReference: (r.account_reference as string | null) ?? null,
        at: r.created_at as string,
      })),
      staleDeferred: staleRes.count ?? 0,
    };
  } catch {
    return NONE;
  }
}
