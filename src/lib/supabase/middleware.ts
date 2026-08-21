import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard"];

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

export async function updateSession(request: NextRequest) {
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

  const isProtected = isProtectedPath(request.nextUrl.pathname);

  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirectedFrom", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Defense in depth for forced password change / deactivation: the login
  // action already handles both cases right after sign-in, but this catches
  // anyone who still has a live session (deactivated mid-session, or landed
  // on a protected route another way -- bookmark, deep link, back button).
  if (isProtected && user && !isChangePasswordPath(request.nextUrl.pathname)) {
    const { data: schoolUser } = await supabase
      .from("school_users")
      .select("status, must_change_password")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (schoolUser && schoolUser.status !== "active") {
      await supabase.auth.signOut();
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("deactivated", "1");
      return NextResponse.redirect(loginUrl);
    }

    if (schoolUser?.must_change_password) {
      const changePasswordUrl = request.nextUrl.clone();
      changePasswordUrl.pathname = "/change-password";
      return NextResponse.redirect(changePasswordUrl);
    }
  }

  return supabaseResponse;
}

function isChangePasswordPath(pathname: string): boolean {
  if (pathname.startsWith("/change-password")) return true;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return false;
  return ("/" + segments.slice(1).join("/")).startsWith("/change-password");
}
