import { cookies } from "next/headers";
import { INTERNAL_VISITOR_COOKIE, isInternalVisitorValue } from "@/lib/marketing/internal-visitor";
import { toggleInternalVisitor } from "@/app/(admin)/admin/analytics/internal-visitor-actions";

// Small control near the visit counter: stop (or resume) counting visits from THIS browser, so your own testing
// does not inflate "Visits counted by EduCore". Only affects visits made after switching it on.
export async function ExcludeMyVisits() {
  const jar = await cookies();
  const on = isInternalVisitorValue(jar.get(INTERNAL_VISITOR_COOKIE)?.value);
  return (
    <form action={toggleInternalVisitor} className="panel flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
      <p className="text-muted-foreground">
        {on
          ? "This browser's visits are not being counted. Visits recorded before you turned this on stay in the numbers."
          : "Your own visits to the site are counted like anyone else's. Turn this on in each browser you use for testing."}
      </p>
      <button type="submit" className="rounded-md border px-3 py-1.5 font-medium hover:bg-muted">
        {on ? "Count my visits again" : "Don't count my visits"}
      </button>
    </form>
  );
}
