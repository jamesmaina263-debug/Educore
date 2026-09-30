import { compareCatalogueOptions } from "@/lib/subject-catalogue-label";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminKicdContentPanel, type KicdSourceRow, type KicdLearningAreaRow, type CatalogueOption } from "@/components/admin/admin-kicd-content-panel";

export default async function AdminKicdContentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const [{ data: areas }, { data: catalogue }] = await Promise.all([
    supabase.from("kicd_learning_areas").select("id, name, catalogue_id").order("name"),
    supabase.from("subject_catalogue").select("id, name, grade_band").order("name"),
  ]);

  const { data } = await supabase
    .from("kicd_content_sources")
    .select(
      "id, name, licence_reference, licence_scope, attribution, source_document, is_enabled, created_at, schools(name), kicd_strands(id, name, grade, kicd_learning_areas(name), kicd_sub_strands(id, name, learning_outcomes, key_inquiry_questions, rubric_text))",
    )
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">KICD content</h1>
        <p className="text-sm text-muted-foreground">
          Import official curriculum documents as shared content for all schools. Every import needs a licence reference and
          attribution, starts <strong>unpublished</strong>, and only becomes visible after you review it and publish it. Withdrawing a
          source hides it from every school immediately. Content imported by a school&apos;s own management is private to that school
          and is labelled below; you can still withdraw it. Published <strong>platform-wide</strong> content (not tied to a school)
          grounds AI Scheme of Work drafts for classes with a KICD grade set, in subjects whose catalogue entry is linked to the
          learning area below. A school&apos;s own reviewed content always takes precedence. Schools&apos; own private KICD imports
          don&apos;t ground generation yet.
        </p>
      </div>
      <AdminKicdContentPanel
        sources={(data ?? []) as unknown as KicdSourceRow[]}
        learningAreas={(areas ?? []) as KicdLearningAreaRow[]}
        catalogue={((catalogue ?? []) as CatalogueOption[]).slice().sort(compareCatalogueOptions)}
      />
    </div>
  );
}
