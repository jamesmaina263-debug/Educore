import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { loadReportCardDocuments, type ReportCardScope } from "@/lib/academics/report-card-document";
import { ReportCardDocumentSet } from "@/components/exams/report-card-document";

type SearchParams = Promise<{ exam?: string; class?: string; stream?: string; student?: string }>;

// Browsers suggest the page title as the file name in "Save as PDF", so a class or stream print is
// titled e.g. "Grade 7 East - Mid term - Report Cards" instead of "EduCore". Best effort: if the
// lookup fails or the caller can't read the rows, the default title is kept.
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { exam, class: classId, stream, student } = await searchParams;
  if (!exam || student || (!classId && !stream)) return {};
  try {
    const supabase = await createClient();
    const [{ data: examRow }, label] = await Promise.all([
      supabase.from("exams").select("name").eq("id", exam).maybeSingle(),
      (async () => {
        if (stream) {
          const { data } = await supabase.from("streams").select("name, classes(name)").eq("id", stream).maybeSingle();
          const cls = data?.classes as unknown as { name: string } | { name: string }[] | null | undefined;
          const className = (Array.isArray(cls) ? cls[0]?.name : cls?.name) ?? "";
          return data ? `${className} ${data.name as string}`.trim() : null;
        }
        const { data } = await supabase.from("classes").select("name").eq("id", classId as string).maybeSingle();
        return (data?.name as string | undefined) ?? null;
      })(),
    ]);
    if (!examRow?.name || !label) return {};
    return { title: { absolute: `${label} - ${examRow.name as string} - Report Cards` } };
  } catch {
    return {};
  }
}

// Printable report card(s): ?exam=&student= prints one, ?exam=&stream= prints one stream, and
// ?exam=&class= prints the whole class (one A4 page each). Staff browser print -> "Save as PDF" gives
// the PDF. No permission logic here: RLS decides which report cards the caller can see, and anything
// not visible is simply absent (notFound when nothing is visible), same standard as the payment
// receipt route.
export default async function PrintReportCardsPage({ searchParams }: { searchParams: SearchParams }) {
  const { exam, class: classId, stream, student } = await searchParams;
  if (!exam || (!classId && !stream && !student)) notFound();

  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const scope: ReportCardScope = student ? { studentId: student } : stream ? { streamId: stream } : { classId: classId as string };
  const docs = await loadReportCardDocuments(supabase, exam, scope, { includeClassSize: true });
  if (docs.length === 0) notFound();

  const back = `/exams/report-cards?exam=${encodeURIComponent(exam)}${classId ? `&class=${encodeURIComponent(classId)}` : ""}`;
  return <ReportCardDocumentSet docs={docs} backHref={back} />;
}
