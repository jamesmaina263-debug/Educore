"use client";

import { OfflineBanner, type OfflineBannerProps } from "@/components/shared/offline-banner";

const MUTATION_LABELS: Record<string, string> = {
  issueLoanAction: "Loan issued",
  issueLoanToStaffAction: "Loan issued (staff)",
  returnLoanAction: "Loan returned",
  markLoanLostOrDamagedAction: "Loan marked lost/damaged",
};

export function LibraryOfflineBanner(props: Omit<OfflineBannerProps, "mutationLabels">) {
  return <OfflineBanner {...props} mutationLabels={MUTATION_LABELS} />;
}
