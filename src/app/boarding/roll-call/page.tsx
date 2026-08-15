import { loadBoardingContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { RollCallSection } from "@/components/boarding/roll-call-section";

export default async function BoardingRollCallPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; session?: string }>;
}) {
  const { date, session } = await searchParams;
  const ctx = await loadBoardingContext(date, session);
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Boarding"
      moduleHref="/boarding/dashboard"
      section="Roll Call"
      title="Roll Call"
    >
      <RollCallSection date={ctx.rollCallDate} session={ctx.rollCallSession} students={ctx.rollCallStudents} canWrite={ctx.canWrite} />
    </ModulePageShell>
  );
}
