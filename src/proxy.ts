import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { resolveSlugRouting, applySlugRouting } from "@/lib/school-slug-routing";

export async function proxy(request: NextRequest) {
  const sessionResponse = await updateSession(request);

  // updateSession already decided to redirect (protected route, no session)
  // -- honor that as-is and skip slug routing, since we're heading to /login.
  if (sessionResponse.headers.get("location")) {
    return sessionResponse;
  }

  const routing = resolveSlugRouting(request);
  return applySlugRouting(routing, sessionResponse);
}

export const config = {
  // Excludes Next internals, favicon.ico, and image extensions (as before),
  // plus the PWA static assets under /public that were falling through this
  // matcher and being misrouted as an unrecognized "school slug" -- sw.js,
  // offline.html, and manifest.webmanifest were each getting rewritten to
  // /dashboard (redirecting to /login for anyone unauthenticated) instead of
  // being served as the real files. That silently broke service worker
  // registration entirely: the browser fetched /sw.js, got back the login
  // page's HTML instead of the script, and registration failed with a
  // MIME-type mismatch (swallowed by the .catch() in
  // service-worker-register.tsx), so no service worker -- and therefore no
  // offline fallback -- was ever actually running.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|offline\\.html|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|json|webmanifest)$).*)",
  ],
};
