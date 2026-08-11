import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Button } from "@/components/ui/button";
import { WizardShell, type WizardStep } from "./wizard-shell";

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
    .select("id, application_number, status, first_name, last_name, boarding_preference, transport_required, wizard_current_step")
    .eq("id", id)
    .maybeSingle();

  if (!application) notFound();
  if (!ENTERABLE_STATUSES.includes(application.status)) redirect(`/admissions/${id}`);

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
    { id: "admission_details", label: "Admission Details", applicable: true, note: "Admission type, academic year, term, campus, and intended class. Built in Phase 12." },
    { id: "student", label: "Student", applicable: true, note: "Student biodata, shown for verification against the original application, plus duplicate-student detection. Built in Phase 12." },
    { id: "guardian", label: "Guardian", applicable: true, note: "Search and link an existing guardian, or create a new one. Built in Phase 12." },
    { id: "documents", label: "Documents", applicable: true, note: "Documents already submitted online, plus upload/verify/reject for anything missing. Built in Phase 12." },
    { id: "academics", label: "Academic Placement", applicable: true, note: "Class and stream placement with live capacity from Academics. Built in Phase 12." },
    { id: "boarding", label: "Boarding", applicable: application.boarding_preference !== "day", note: "Boarding house, dormitory, room, and bed with live availability from Boarding. Built in Phase 12." },
    { id: "transport", label: "Transport", applicable: application.transport_required !== false, note: "Route, pickup point, and vehicle with live capacity from Transport. Built in Phase 12." },
    { id: "health", label: "Health", applicable: true, note: "Initial health profile only — blood group, allergies, known conditions. Built in Phase 12." },
    { id: "finance", label: "Finance", applicable: true, note: "Applicable charges from fee configuration, with an option to record an initial payment. Built in Phase 12." },
    { id: "review", label: "Final Review", applicable: true, note: "Editable summary of every step before committing. Built in Phase 12." },
    { id: "complete", label: "Complete", applicable: true, note: "Complete Enrollment — creates the student record and every linked module record in one transaction. Built in Phase 12." },
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
      />
    </AppShell>
  );
}
