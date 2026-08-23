"use client";

import { OfflineBanner, type OfflineBannerProps } from "@/components/shared/offline-banner";

const MUTATION_LABELS: Record<string, string> = {
  checkInStudent: "Sick bay check-in",
  checkOutStudent: "Sick bay check-out",
  administerMedication: "Medication administered",
  logEmergency: "Emergency log",
  createReferral: "Referral",
};

/**
 * The offline-queue banners shared by every health write form (sick bay,
 * medication, emergencies, referrals) -- all share the "health" module
 * queue, so a nurse sees one consistent count/status regardless of which
 * tab queued something.
 *
 * Queued items don't appear in this page's table until they've actually
 * synced (there's no local table row to show for something that only
 * exists in this device's IndexedDB yet) -- these banners are what confirm
 * "your submission was captured" in the meantime.
 */
export function HealthOfflineBanner(props: Omit<OfflineBannerProps, "mutationLabels">) {
  return <OfflineBanner {...props} mutationLabels={MUTATION_LABELS} />;
}
