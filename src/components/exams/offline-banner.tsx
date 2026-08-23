"use client";

import { OfflineBanner, type OfflineBannerProps } from "@/components/shared/offline-banner";

const MUTATION_LABELS: Record<string, string> = {
  submitMarks: "Subject marks",
  submitCompetencyMarks: "Competency marks",
};

const OFFLINE_MESSAGE = (
  <>
    You&apos;re offline. Marks you submit now are saved on this device and will sync automatically once
    you&apos;re back online.
  </>
);

/**
 * The offline-queue banners shared by both exams write forms (numeric/CBC
 * marks entry and the competency sub-strand grid) -- both share the "exams"
 * module queue, so a teacher sees one consistent count/status regardless of
 * which form queued something.
 */
export function ExamsOfflineBanner(
  props: Omit<OfflineBannerProps, "mutationLabels" | "offlineMessage" | "syncingLabel" | "unitNoun">,
) {
  return (
    <OfflineBanner
      {...props}
      mutationLabels={MUTATION_LABELS}
      offlineMessage={OFFLINE_MESSAGE}
      syncingLabel="Syncing offline marks…"
      unitNoun={{ singular: "submission", plural: "submissions" }}
    />
  );
}
