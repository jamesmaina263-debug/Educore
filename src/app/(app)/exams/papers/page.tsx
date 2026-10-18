import { loadPapersContext } from "./_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { ExamPapersSection } from "@/components/exams/exam-papers-section";

export default async function ExamPapersPage({
  searchParams,
}: {
  searchParams: Promise<{ exam?: string; class?: string; subject?: string }>;
}) {
  const ctx = await loadPapersContext(await searchParams);
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Exams"
      moduleHref="/exams/overview"
      section="Exam Papers"
      title="Exam papers"
      subtitle="Draft question papers from your curriculum, reviewed by a teacher before use"
    >
      <ExamPapersSection
        canGenerate={ctx.canGenerate}
        classes={ctx.classes}
        subjects={ctx.subjects}
        openExams={ctx.openExams}
        papers={ctx.papers}
        prefill={ctx.prefill}
      />
    </ModulePageShell>
  );
}
