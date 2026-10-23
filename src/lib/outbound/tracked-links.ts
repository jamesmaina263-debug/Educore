import { outreachLink } from "./prospects";

// Per-school tracked links in outreach emails. The email carries /api/outreach-link/<recipient id>/<destination>;
// the route records the click for that school and redirects to the real page with the same UTM tags the untracked
// links always had. The destination is a fixed key, never a URL taken from the request, so the route cannot be
// used as an open redirect. Keys and paths must match the check in record_outreach_click().
export const TRACKED_DESTINATIONS = ["home", "signup", "contact", "brochure"] as const;
export type TrackedDestination = (typeof TRACKED_DESTINATIONS)[number];

const PATHS: Record<TrackedDestination, "" | "/signup" | "/contact" | "/brochure"> = {
  home: "",
  signup: "/signup",
  contact: "/contact",
  brochure: "/brochure",
};

export function isTrackedDestination(value: string): value is TrackedDestination {
  return (TRACKED_DESTINATIONS as readonly string[]).includes(value);
}

/** The page a tracked link lands on: identical to the untracked email link, UTM tags included. */
export function trackedDestinationUrl(dest: TrackedDestination): string {
  return outreachLink(PATHS[dest], "email");
}
