"use client";

import { OfflineBanner, type OfflineBannerProps } from "@/components/shared/offline-banner";

const MUTATION_LABELS: Record<string, string> = {
  submitStaffAttendance: "Staff attendance",
};

const OFFLINE_MESSAGE = (
  <>
    You&apos;re offline. Marks you submit now are saved on this device and will sync automatically once
    you&apos;re back online.
  </>
);

export function StaffOfflineBanner(
  props: Omit<OfflineBannerProps, "mutationLabels" | "offlineMessage" | "syncingLabel" | "unitNoun" | "failedNote">,
) {
  return (
    <OfflineBanner
      {...props}
      mutationLabels={MUTATION_LABELS}
      offlineMessage={OFFLINE_MESSAGE}
      syncingLabel="Syncing offline attendance…"
      unitNoun={{ singular: "submission", plural: "submissions" }}
      failedNote="usually because someone else already marked that day"
    />
  );
}
