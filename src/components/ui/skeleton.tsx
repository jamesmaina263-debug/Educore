import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/** Placeholder block for loading states. Pulse is skipped for users who prefer reduced motion. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)} {...props} />;
}
