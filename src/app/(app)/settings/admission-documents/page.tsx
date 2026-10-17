import { loadSettingsContext } from "../_data";
import { createClient } from "@/lib/supabase/server";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { DocumentRequirementsPanel } from "@/components/settings/document-requirements-panel";
import { listDocumentRequirements } from "./actions";

export default async function SettingsAdmissionDocumentsPage() {
  const ctx = await loadSettingsContext();
  const supabase = await createClient();
  const [rows, { data: canWrite }] = await Promise.all([
    listDocumentRequirements(),
    supabase.rpc("auth_has_permission", { p_permission_key: "admissions.write" }),
  ]);
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Admission Documents"
      title="Settings"
    >
      <DocumentRequirementsPanel rows={rows} canWrite={canWrite === true} />
    </ModulePageShell>
  );
}
