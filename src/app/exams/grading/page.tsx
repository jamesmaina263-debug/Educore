import { loadExamsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { GradingScalesSection } from "@/components/exams/grading-scales-section";

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
      <GradingScalesSection scales={ctx.scaleRows} classes={ctx.gradingClasses} canWrite={ctx.canWrite} />
    </ModulePageShell>
  );
}
