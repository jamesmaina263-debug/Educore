import { loadAcademicsContext } from "../_data";
import { createClient } from "@/lib/supabase/server";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { NewslettersSection, type NewsletterDraftRow } from "@/components/academics/newsletters-section";

export default async function NewslettersPage() {
  const ctx = await loadAcademicsContext();
  const supabase = await createClient();

  const { data: draftRows } = ctx.canSendNewsletter
    ? await supabase
        .from("term_newsletter_drafts")
        .select("id, term_id, trigger_type, draft_body, ai_drafted, status, generated_at, sent_at, recipient_count, terms(name, end_date)")
        .order("generated_at", { ascending: false })
        .limit(100)
    : { data: null };

  const drafts: NewsletterDraftRow[] = (draftRows ?? []).map((r) => {
    const term = r.terms as unknown as { name: string; end_date: string } | null;
    return {
      id: r.id as string,
      termId: r.term_id as string,
      termName: term?.name ?? "Unknown term",
      termEndDate: term?.end_date ?? "",
      triggerType: r.trigger_type as "automatic" | "manual",
      draftBody: r.draft_body as string,
      aiDrafted: r.ai_drafted as boolean,
      status: r.status as NewsletterDraftRow["status"],
      generatedAt: r.generated_at as string,
      sentAt: r.sent_at as string | null,
      recipientCount: (r.recipient_count as number | null) ?? null,
    };
  });

  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Academics"
      moduleHref="/academics/years-terms"
      section="Newsletters"
      title="Newsletters"
      subtitle="Review and edit each term's newsletter before it goes out to guardians"
      noAccess={!ctx.canSendNewsletter}
    >
      <NewslettersSection drafts={drafts} canWrite={ctx.canSendNewsletter} />
    </ModulePageShell>
  );
}
