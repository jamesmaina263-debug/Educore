import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadReportCardDocuments, type ReportCardScope } from "@/lib/academics/report-card-document";
import { ReportCardDocumentSet } from "@/components/exams/report-card-document";

// Parent/student-portal report card. Standalone (no staff shell), like the portal receipt page.
// RLS only exposes a guardian's own child's RELEASED report card (teacher-approved or
// teacher-written comment), so an unreleased or foreign card resolves to notFound() and no
// extra permission logic lives here. ?child= selects one child; without it the caller's own
// visible cards for the exam are shown.
export default async function PortalReportCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ child?: string }>;
}) {
  const { examId } = await params;
  const { child } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/parent-login");

  const scope: ReportCardScope = child ? { studentId: child } : { all: true };
  const docs = (await loadReportCardDocuments(supabase, examId, scope)).filter((d) => d.released);
  if (docs.length === 0) notFound();
  return <ReportCardDocumentSet docs={docs} backHref={child ? `/portal?child=${encodeURIComponent(child)}` : "/portal"} />;
}
