"use client";

import { RouteError } from "@/components/shared/route-error";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} homeHref="/portal" homeLabel="Back to portal" />;
}
