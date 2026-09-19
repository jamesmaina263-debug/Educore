import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { APP_ROUTE_SEGMENTS } from "@/lib/school-slug-routing";

const PROTECTED_PREFIXES = ["/dashboard"];

// Everything a school staff member can reach, minus "admin" -- APP_ROUTE_SEGMENTS includes it
// only so school-slug-routing's own bookkeeping stays in sync with real (app) folders, but the
// platform admin console must never be affected by maintenance mode (it's how a super_admin
// turns maintenance back off), so it's explicitly excluded here regardless of what that set
// contains.
const MAINTENANCE_GATED_SEGMENTS = new Set(APP_ROUTE_SEGMENTS);
MAINTENANCE_GATED_SEGMENTS.delete("admin");

// Same bare-vs-slug-prefixed shape as isProtectedPath below, generalized to the whole
// school-app surface instead of just "/dashboard" -- this is the single choke point every
// staff-app request passes through (proxy.ts's matcher), so it's the one place a platform-wide
// maintenance switch can gate every school-facing route without touching the 40+ individual
// pages that each carry their own auth check.
function isMaintenanceGatedPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  if (MAINTENANCE_GATED_SEGMENTS.has(segments[0])) return true;
  if (segments.length >= 2 && MAINTENANCE_GATED_SEGMENTS.has(segments[1])) return true;
  return false;
}

function isProtectedPath(pathname: string): boolean {
  // Bare form ("/dashboard...") or slug-prefixed form ("/{slug}/dashboard...")
  // -- this runs before school-slug-routing's rewrite, so both shapes can
  // reach here depending on whether the browser already has a slug cookie.
  if (PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return false;
  const withoutFirstSegment = "/" + segments.slice(1).join("/");
  return PROTECTED_PREFIXES.some((prefix) => withoutFirstSegment.startsWith(prefix));
}

export type SessionUpdate = {
  response: NextResponse;
  // Whether supabase.auth.getUser() below found a valid session. Exposed so
  // callers (school-slug-routing's fallback branch) can make an
  // auth-aware routing decision without making their own DB/network call --
  // this is the exact same getUser() result already computed here for
  // every request, just threaded through instead of discarded.
  isAuthenticated: boolean;
};

export async function updateSession(request: NextRequest): Promise<SessionUpdate> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not remove this call — it refreshes the auth token and
  // must run before any route logic reads the session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Real "is this school using the app today" signal for the admin console, distinct from
  // auth.users.last_sign_in_at (only moves on an actual sign-in, not a refreshed session --
  // see migration 20260918120000). Throttled via a plain cookie read so a returning user
  // doesn't cost a DB round trip on every request -- only when the cookie is missing/stale
  // do we call the RPC, which itself re-checks staleness server-side before writing.
  if (user) {
    const LAST_SEEN_PING_COOKIE = "edu_last_seen_ping";
    const THROTTLE_MS = 5 * 60 * 1000;
    const lastPing = Number(request.cookies.get(LAST_SEEN_PING_COOKIE)?.value ?? 0);
    if (!lastPing || Date.now() - lastPing > THROTTLE_MS) {
      try {
        await supabase.rpc("bump_last_seen");
      } catch {
        // Never let a last-seen ping failure block or redirect a real request.
      }
      supabaseResponse.cookies.set(LAST_SEEN_PING_COOKIE, String(Date.now()), {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24,
      });
    }
  }

  // Platform-wide maintenance kill switch (see /admin/broadcast's maintenance toggle and the
  // 20260919133000 migration). Checked only for school-facing routes -- /admin, the marketing
  // site, /login, /apply, /portal, cron/webhook API routes etc. are all untouched. Wrapped in
  // try/catch and fails open (never blocks) on any error: a bug or outage in this check must
  // never itself take the whole platform down.
  if (isMaintenanceGatedPath(request.nextUrl.pathname)) {
    try {
      const { data: maintenance } = await supabase
        .from("platform_maintenance")
        .select("enabled")
        .eq("id", 1)
        .maybeSingle();

      if (maintenance?.enabled) {
        let isSuperAdminBypass = false;
        if (user) {
          const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
          isSuperAdminBypass = isSuperAdmin === true;
        }
        if (!isSuperAdminBypass) {
          const maintenanceUrl = request.nextUrl.clone();
          maintenanceUrl.pathname = "/maintenance";
          maintenanceUrl.search = "";
          return { response: NextResponse.redirect(maintenanceUrl), isAuthenticated: !!user };
        }
      }
    } catch {
      // Fail open -- see comment above.
    }
  }

  const isProtected = isProtectedPath(request.nextUrl.pathname);

  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirectedFrom", request.nextUrl.pathname);
    return { response: NextResponse.redirect(loginUrl), isAuthenticated: false };
  }

  // Defense in depth for forced password change / deactivation: the login
  // action already handles both cases right after sign-in, but this catches
  // anyone who still has a live session (deactivated mid-session, or landed
  // on a protected route another way -- bookmark, deep link, back button).
  if (isProtected && user && !isChangePasswordPath(request.nextUrl.pathname)) {
    const { data: schoolUser } = await supabase
      .from("school_users")
      .select("status, must_change_password, schools(status)")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (schoolUser && schoolUser.status !== "active") {
      await supabase.auth.signOut();
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("deactivated", "1");
      return { response: NextResponse.redirect(loginUrl), isAuthenticated: false };
    }

    // Same school-suspension gate as login/actions.ts, for anyone who was already
    // mid-session when their school got suspended (login's own check only runs at
    // sign-in time). 'trial'/'active' pass; 'suspended'/'cancelled' get signed out.
    const schoolStatus = (schoolUser?.schools as unknown as { status: string } | null)?.status;
    if (schoolUser && (schoolStatus === "suspended" || schoolStatus === "cancelled")) {
      await supabase.auth.signOut();
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("suspended", "1");
      return { response: NextResponse.redirect(loginUrl), isAuthenticated: false };
    }

    if (schoolUser?.must_change_password) {
      const changePasswordUrl = request.nextUrl.clone();
      changePasswordUrl.pathname = "/change-password";
      return { response: NextResponse.redirect(changePasswordUrl), isAuthenticated: true };
    }
  }

  return { response: supabaseResponse, isAuthenticated: !!user };
}

function isChangePasswordPath(pathname: string): boolean {
  if (pathname.startsWith("/change-password")) return true;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return false;
  return ("/" + segments.slice(1).join("/")).startsWith("/change-password");
}
