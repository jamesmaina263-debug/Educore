"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RotateCw, TriangleAlert, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isMarketingPath } from "@/lib/marketing-routes";

/**
 * Fallback UI shared by every route-level `error.tsx`.
 *
 * Why this exists: before it, any unhandled error on a page showed Next.js's generic
 * "This page couldn't load" screen. This keeps the surrounding layout (sidebar/topbar) on
 * screen and gives the person a retry, a way out, and a reference code to quote to support.
 *
 * Reporting: errors thrown while rendering on the server are already captured by
 * `onRequestError` in src/instrumentation.ts and reach this component with a `digest`.
 * Only errors without a digest (thrown in the browser) are captured here, so a single
 * failure isn't reported to Sentry twice. Marketing pages are skipped, matching
 * src/instrumentation-client.ts, which deliberately never loads Sentry there.
 */
export function RouteError({
  error,
  retry,
  homeHref,
  homeLabel,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  homeHref: string;
  homeLabel: string;
}) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    console.error(error);
    if (error.digest) return;
    if (isMarketingPath(window.location.pathname)) return;
    import("@sentry/nextjs")
      .then((Sentry) => Sentry.captureException(error))
      .catch(() => {
        // Reporting is best-effort; never let it break the fallback screen.
      });
  }, [error]);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const Icon = offline ? WifiOff : TriangleAlert;

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg items-center justify-center p-6">
      <div role="alert" className="panel w-full p-6 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-destructive-subtle text-destructive">
          <Icon className="size-5" aria-hidden />
        </div>
        <h1 className="mt-4 text-base font-semibold">
          {offline ? "You appear to be offline" : "This page couldn't load"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {offline
            ? "Check your internet connection, then try again. Pages you visited before may still be available from the menu."
            : "Something went wrong while loading this page. The rest of EduCore is not affected. Please try again."}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => retry()}>
            <RotateCw aria-hidden />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href={homeHref}>{homeLabel}</Link>
          </Button>
        </div>
        {!offline && (
          <p className="mt-5 text-xs text-muted-foreground">
            If this keeps happening, contact{" "}
            <a className="underline underline-offset-2" href="mailto:support@educoreafrica.com">
              support@educoreafrica.com
            </a>
            {error.digest ? (
              <>
                {" "}
                and quote reference <span className="font-mono">{error.digest}</span>
              </>
            ) : null}
            .
          </p>
        )}
      </div>
    </div>
  );
}
