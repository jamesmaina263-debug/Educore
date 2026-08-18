import type { cookies } from "next/headers";

// Set at login/signup, read by middleware.ts to build slug-prefixed URLs
// (e.g. /gititu-high-school/dashboard) without a DB lookup on every request.
// Cosmetic only -- it never grants access on its own; every page and RPC
// still enforces real authorization via auth_school_id()/RLS regardless of
// what's in the URL or this cookie. Cleared for super_admin accounts, whose
// /admin pages are platform-wide and were never slug-prefixed.
export const SCHOOL_SLUG_COOKIE = "edu_slug";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export function setSchoolSlugCookie(cookieStore: CookieStore, slug: string) {
  cookieStore.set(SCHOOL_SLUG_COOKIE, slug, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSchoolSlugCookie(cookieStore: CookieStore) {
  cookieStore.delete(SCHOOL_SLUG_COOKIE);
}
