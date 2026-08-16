import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Button } from "@/components/ui/button";
import { WizardShell, type WizardStep } from "./wizard-shell";
import { loadWizardStepData } from "./wizard-data";

// Both entry points converge here (Brief 4.16.1): a walk-in draft, or an online application the
// officer has already Accepted (status = admission_pending) or Conditionally Accepted. Anything
// else (still under review, rejected, already enrolled, ...) has no business in the wizard yet.
const ENTERABLE_STATUSES = ["draft", "admission_pending", "conditionally_accepted"];

export default async function AdmissionWizardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "admissions.write" }),
  ]);
  if (!canWrite) redirect("/admissions");

  const { data: application } = await supabase
    .from("applications")
    .select("id, school_id, application_number, status, first_name, last_name, boarding_preference, transport_required, wizard_current_step")
    .eq("id", id)
    .maybeSingle();

  if (!application) notFound();
  if (!ENTERABLE_STATUSES.includes(application.status)) redirect(`/admissions/${id}`);

  const wizardData = await loadWizardStepData(supabase, application.id, application.school_id);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const applicantLabel =
    application.first_name && application.last_name
      ? `${application.first_name} ${application.last_name}`
      : "New walk-in admission";

  // Dynamic skip logic (Brief 4.16.9 / Phase 11 test checklist): day students skip Boarding,
  // students who don't need transport skip Transport. A draft with boarding_preference not yet
  // set shows Boarding rather than guessing — the officer will set it once they reach Admission
  // Details / Academic Placement, and can revisit.
  const steps: WizardStep[] = [
    { id: "admission_details", label: "Admission Details", applicable: true, note: "" },
    { id: "student", label: "Student", applicable: true, note: "" },
    { id: "guardian", label: "Guardian", applicable: true, note: "" },
    { id: "documents", label: "Documents", applicable: true, note: "" },
    { id: "academics", label: "Academic Placement", applicable: true, note: "" },
    { id: "boarding", label: "Boarding", applicable: application.boarding_preference !== "day", note: "" },
    { id: "transport", label: "Transport", applicable: application.transport_required !== false, note: "" },
    { id: "health", label: "Health", applicable: true, note: "" },
    { id: "finance", label: "Finance", applicable: true, note: "" },
    { id: "review", label: "Final Review", applicable: true, note: "Editable summary of every step before committing, plus the admission checklist. Built in Phase 13." },
    { id: "complete", label: "Complete", applicable: true, note: "Complete Enrollment — validates the checklist and finalizes the Student record, Finance invoice, and admission history in one safe, idempotent commit. Built in Phase 13." },
  ];

  return (
    <AppShell
      breadcrumbs={[
        { label: schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Admissions", href: "/admissions" },
        { label: application.application_number, href: `/admissions/${id}` },
        { label: "Wizard" },
      ]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Onboarding — {applicantLabel}</h1>
        <Button asChild variant="outline" size="sm">
          <Link href={`/admissions/${id}`}>Back to application</Link>
        </Button>
      </div>
      <WizardShell
        applicationId={application.id}
        applicantLabel={applicantLabel}
        steps={steps}
        initialStep={application.wizard_current_step ?? 0}
        data={wizardData}
      />
    </AppShell>
  );
}
