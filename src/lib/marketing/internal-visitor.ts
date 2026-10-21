// "Don't count my visits": a platform staff member can mark their own browser so their page views stop being
// recorded in our first-party counter (public.site_page_views). The marker is a plain flag cookie with the value
// "1". It is only ever set by a signed-in platform admin (see setInternalVisitor), identifies no one, and is read
// only by /api/page-view to skip recording. It does nothing to Google Analytics, and views already recorded stay.

export const INTERNAL_VISITOR_COOKIE = "ec_internal";
export const INTERNAL_VISITOR_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** True when the cookie value marks an internal (staff) browser. */
export function isInternalVisitorValue(value: string | undefined | null): boolean {
  return value === "1";
}

/** Reads the marker from a raw Cookie request header. Never throws; anything unexpected means "not internal". */
export function hasInternalVisitorCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === INTERNAL_VISITOR_COOKIE) return isInternalVisitorValue(part.slice(eq + 1).trim());
  }
  return false;
}
