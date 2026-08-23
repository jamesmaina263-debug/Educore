"use client";

import { OfflineBanner, type OfflineBannerProps } from "@/components/shared/offline-banner";

const MUTATION_LABELS: Record<string, string> = {
  updateAdmissionDetails: "Admission details",
  updateApplicantIdentity: "Applicant identity",
  saveHealthProfileForApplication: "Health profile",
};

const OFFLINE_MESSAGE = (
  <>
    You&apos;re offline. Admission Details, Applicant Identity, and Health Profile saves are captured on this
    device and sync automatically once you&apos;re back online -- other steps (duplicate check, guardian search,
    documents, finance, enrollment) need a connection.
  </>
);

/**
 * Offline-queue banners for the admissions wizard's queueable steps.
 *
 * Only 3 of the wizard's ~20 actions are queued (see docs/OFFLINE_ROLLOUT.md
 * for why) -- most of the wizard, including duplicate detection and the
 * final enrollment step, still needs a live connection to progress. This
 * banner communicates the narrower promise: "this specific field save is
 * captured," not "the whole wizard works offline."
 */
export function AdmissionsOfflineBanner(props: Omit<OfflineBannerProps, "mutationLabels" | "offlineMessage">) {
  return <OfflineBanner {...props} mutationLabels={MUTATION_LABELS} offlineMessage={OFFLINE_MESSAGE} />;
}
