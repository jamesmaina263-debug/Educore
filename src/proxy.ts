import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { rootAuthFallback } from "@/lib/auth/reset-link";
import { resolveSlugRouting, applySlugRouting } from "@/lib/school-slug-routing";

export async function proxy(request: NextRequest) {
  // Safety net: a password-reset link that still lands on "/" (Supabase appends ?code= or
  // ?error_code= there when redirect_to isn't honoured) is forwarded to the real handler instead
  // of dead-ending on the marketing home page. Matches only "/" with those params.
  const authFallback = rootAuthFallback(request.nextUrl);
  if (authFallback) {
    return NextResponse.redirect(new URL(authFallback, request.url));
  }

  const { response: sessionResponse, isAuthenticated } = await updateSession(request);

  // updateSession already decided to redirect (protected route, no session)
  // -- honor that as-is and skip slug routing, since we're heading to /login.
  if (sessionResponse.headers.get("location")) {
    return sessionResponse;
  }

  const routing = resolveSlugRouting(request, isAuthenticated);
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
  //
  // Same bug, same fix, for `pdf`/`doc`/`docx`/`zip`: the lead-magnet
  // download at /downloads/cbc-digital-readiness-checklist.pdf hit this
  // exact gap -- "downloads" isn't a real school slug or APP_ROUTE_SEGMENT,
  // so resolveSlugRouting's fallback branch treated it as one and stripped
  // it, rewriting to /cbc-digital-readiness-checklist.pdf (no such route,
  // 404) instead of ever reaching the real static file. Extending the
  // extension list here (rather than adding "downloads" to NEVER_PREFIX)
  // covers this file and any future doc dropped under /public the same way,
  // without special-casing one folder name.
  //
  // Public marketing routes (the second alternative group below, listed explicitly because Next
  // requires `matcher` to be a static literal) are also excluded. They never read the session
  // (see (marketing)/layout.tsx), their server actions use the admin client, none of them is a
  // school-app path (so no maintenance gate / protected redirect / slug rewrite ever applied),
  // and every one is already in NEVER_PREFIX. Running the proxy there only cost a function
  // invocation + a Supabase client per hit (including every crawler hit). "/" itself stays
  // matched on purpose (rootAuthFallback). src/proxy.test.ts keeps this list in sync with the
  // real (marketing) folders and proves every app/auth/api path is still matched.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|offline\\.html|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|(?:about|ai-automation|blog|cbc-school-management|contact|faq|finance-fees|parent-communication|platform|pricing|privacy|school-attendance-management|security|solutions|student-management-system|student-performance-appraisal|teacher-performance-management|terms)(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|json|webmanifest|pdf|doc|docx|zip)$).*)",
  ],
};
