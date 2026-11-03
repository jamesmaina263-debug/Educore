"use server";

import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { LIVE_TRACKING_FLAG, parseFleetRows, type FleetVehicle } from "@/lib/bus-live";

// WP 5.3: staff fleet view. A thin call to fleet_live_status(), which runs with the caller's own rights, so the
// existing transport.read_any policies decide what comes back (nothing without that permission). Read-only.

export type FleetLiveResult = { success: true; vehicles: FleetVehicle[]; fetchedAt: string } | { error: string };

export async function getFleetLiveAction(): Promise<FleetLiveResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };
  if (!(await hasFeatureFlag(supabase, LIVE_TRACKING_FLAG))) return { error: "Live tracking is not switched on for this school." };

  const { data, error } = await supabase.rpc("fleet_live_status");
  if (error) return { error: "Could not load vehicle positions. Please try again." };
  return { success: true, vehicles: parseFleetRows(data), fetchedAt: new Date().toISOString() };
}
