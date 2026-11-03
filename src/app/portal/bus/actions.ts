"use server";

import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { isUuid, parseGuardianBusStatus, type GuardianBusStatus } from "@/lib/bus-live";

// WP 5.3: parent bus view. A thin call to guardian_bus_status(), which re-checks everything in the database: the
// caller must be a guardian of that learner in the same school, both feature flags must be on, and a position is
// only returned while it is fresh. This action only validates input and parses the answer; it never builds a
// position of its own, and any error becomes "unavailable" (no position).

const MAX_CHILDREN = 10;

export type BusStatusesResult = { success: true; statuses: Record<string, GuardianBusStatus> } | { error: string };

export async function getBusStatusesAction(childIds: string[]): Promise<BusStatusesResult> {
  if (!Array.isArray(childIds)) return { error: "Invalid request." };
  const ids = Array.from(new Set(childIds.filter(isUuid))).slice(0, MAX_CHILDREN);
  if (ids.length === 0) return { error: "Invalid request." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const entries = await Promise.all(
    ids.map(async (id): Promise<[string, GuardianBusStatus]> => {
      try {
        const { data, error } = await supabase.rpc("guardian_bus_status", { p_student_id: id });
        if (error) return [id, { status: "unavailable" }];
        return [id, parseGuardianBusStatus(data)];
      } catch {
        return [id, { status: "unavailable" }];
      }
    }),
  );
  return { success: true, statuses: Object.fromEntries(entries) };
}
