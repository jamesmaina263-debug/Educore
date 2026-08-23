"use client";

import { OfflineBanner, type OfflineBannerProps } from "@/components/shared/offline-banner";

const MUTATION_LABELS: Record<string, string> = {
  submitRollCall: "Roll call",
  logIncident: "Incident log",
};

/**
 * The offline-queue banners shared by boarding's write forms (roll call,
 * incidents) -- both share the "boarding" module queue, so staff see one
 * consistent count/status regardless of which tab queued something.
 */
export function BoardingOfflineBanner(props: Omit<OfflineBannerProps, "mutationLabels">) {
  return <OfflineBanner {...props} mutationLabels={MUTATION_LABELS} />;
}
