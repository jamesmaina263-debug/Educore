import { loadExamsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { ExamsSection } from "@/components/exams/exams-section";

export default async function ExamsOverviewPage() {
  const ctx = await loadExamsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Exams"
      moduleHref="/exams/overview"
      section="Overview"
      title="Exams"
      subtitle="CATs, exams, grading scales and marks entry"
    >
      <ExamsSection
        exams={ctx.examRows}
        terms={ctx.terms}
        classes={ctx.classes}
        subjects={ctx.subjects}
        canWrite={ctx.canWrite}
        hasGradingScale={ctx.hasGradingScale}
      />
    </ModulePageShell>
  );
}
