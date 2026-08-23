"use client";

import { OfflineBanner, type OfflineBannerProps } from "@/components/shared/offline-banner";

const MUTATION_LABELS: Record<string, string> = {
  createIncidentAction: "Incident",
  addDisciplinaryActionAction: "Disciplinary action",
  createCaseAction: "Case",
  createWelfareConcernAction: "Welfare concern",
  createSafeguardingReportAction: "Safeguarding report",
};

export function DisciplineOfflineBanner(props: Omit<OfflineBannerProps, "mutationLabels">) {
  return <OfflineBanner {...props} mutationLabels={MUTATION_LABELS} />;
}
