import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApplicationForm, type DocumentRequirement } from "./application-form";

// This page uses the service-role admin client and never reads cookies/headers,
// so it has nothing that would otherwise force Next.js into dynamic rendering --
// left alone, it's eligible to be statically cached (indefinitely, by default)
// the first time any slug is visited. That's a real bug for a public link: if a
// school's slug later changes (rename, typo fix, regeneration), visitors with
// the old link would keep getting served the stale cached page -- rendering
// fine, listing the right document requirements, everything -- right up until
// they hit Submit, at which point submitApplication() (a Server Action, always
// executed live) does its own fresh lookup, doesn't find the now-nonexistent
// slug, and returns "We couldn't find this school." The page looked correct;
// only the live submission path was ever telling the truth. Forcing dynamic
// rendering here makes the page's own lookup live too, so a dead/renamed slug
// 404s immediately on load instead of only failing silently at submit time.
export const dynamic = "force-dynamic";

export default async function ApplyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    notFound();
  }

  const { data: school } = await admin
    .from("schools")
    .select("id, name, slug, motto, logo_url, status")
    .eq("slug", slug)
    .maybeSingle();

  if (!school) notFound();

  const notAccepting = school.status === "suspended" || school.status === "cancelled";

  let documentRequirements: DocumentRequirement[] = [];
  if (!notAccepting) {
    const { data: requirements } = await admin
      .from("application_document_requirements")
      .select("category, label, required")
      .eq("school_id", school.id)
      .order("display_order");
    documentRequirements = requirements ?? [];
  }

  return (
    <div className="flex min-h-screen justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg space-y-4">
        <div className="rounded-md border border-border bg-surface p-6 text-center">
          {school.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={school.logo_url} alt="" className="mx-auto mb-3 h-12 w-12 rounded object-contain" />
          )}
          <h1 className="text-lg font-semibold">{school.name}</h1>
          {school.motto && <p className="text-sm text-muted-foreground">{school.motto}</p>}
          <p className="mt-2 text-sm text-muted-foreground">Student admission application</p>
        </div>

        {notAccepting ? (
          <div className="rounded-md border border-border bg-surface p-6 text-center text-sm text-muted-foreground">
            This school is not accepting online applications at the moment. Please contact the school
            office directly.
          </div>
        ) : (
          <div className="rounded-md border border-border bg-surface p-6">
            <ApplicationForm schoolSlug={school.slug} documentRequirements={documentRequirements} />
          </div>
        )}
      </div>
    </div>
  );
}
