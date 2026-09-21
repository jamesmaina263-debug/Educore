"use client";

import { RouteError } from "@/components/shared/route-error";

// Catch-all for segments without their own error.tsx (login, apply, marketing, ...). The
// staff app, admin console and parent portal each have a more specific one.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} homeHref="/" homeLabel="Go to home page" />;
}
