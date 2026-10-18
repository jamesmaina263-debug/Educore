import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { loadReportCardDocuments, type ReportCardScope } from "@/lib/academics/report-card-document";
import { ReportCardDocumentSet } from "@/components/exams/report-card-document";

// Printable report card(s): ?exam=&student= prints one, ?exam=&class= prints the whole class (one
// A4 page each). Staff browser print -> "Save as PDF" gives the PDF. No permission logic here:
// RLS decides which report cards the caller can see, and anything not visible is simply absent
// (notFound when nothing is visible), same standard as the payment receipt route.
export default async function PrintReportCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ exam?: string; class?: string; student?: string }>;
}) {
  const { exam, class: classId, student } = await searchParams;
  if (!exam || (!classId && !student)) notFound();

  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const scope: ReportCardScope = student ? { studentId: student } : { classId: classId as string };
  const docs = await loadReportCardDocuments(supabase, exam, scope);
  if (docs.length === 0) notFound();

  const back = `/exams/report-cards?exam=${encodeURIComponent(exam)}${classId ? `&class=${encodeURIComponent(classId)}` : ""}`;
  return <ReportCardDocumentSet docs={docs} backHref={back} />;
}
