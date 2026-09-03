import { loadExamsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { GradingScalesSection } from "@/components/exams/grading-scales-section";
import { AssessmentSchemesSection } from "@/components/exams/assessment-schemes-section";

export default async function ExamsGradingPage() {
  const ctx = await loadExamsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Exams"
      moduleHref="/exams/overview"
      section="Grading Scales"
      title="Grading Scales"
    >
      <div className="flex flex-col gap-8">
        <GradingScalesSection scales={ctx.scaleRows} classes={ctx.gradingClasses} canWrite={ctx.canWrite} />
        <div className="border-t pt-6">
          <AssessmentSchemesSection schemes={ctx.schemeRows} canWrite={ctx.canWrite} />
        </div>
      </div>
    </ModulePageShell>
  );
}
