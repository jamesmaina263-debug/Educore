"use client";

import { OfflineBanner, type OfflineBannerProps } from "@/components/shared/offline-banner";

const MUTATION_LABELS: Record<string, string> = {
  recordStockMovementAction: "Stock movement",
};

export function InventoryOfflineBanner(props: Omit<OfflineBannerProps, "mutationLabels">) {
  return <OfflineBanner {...props} mutationLabels={MUTATION_LABELS} />;
}
