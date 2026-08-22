import { loadMpesaContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { MpesaSettingsCard, MpesaPushPanel } from "@/components/integrations/mpesa-panel";

export default async function IntegrationsMpesaPage() {
  const ctx = await loadMpesaContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Integrations"
      moduleHref="/integrations/nemis"
      section="M-Pesa"
      title="M-Pesa"
      subtitle="Push STK payment prompts straight to a parent's phone. Inactive until your Paybill/Till and Daraja credentials are saved and switched on below."
      noAccess={!ctx.canManageMpesa && !ctx.canInitiatePush}
    >
      <div className="flex flex-col gap-6">
        <MpesaSettingsCard
          canManage={ctx.canManageMpesa}
          shortcode={ctx.shortcode}
          shortcodeType={ctx.shortcodeType}
          environment={ctx.environment}
          isActive={ctx.isActive}
          hasCredentials={ctx.hasCredentials}
        />
        {ctx.canInitiatePush && (
          <MpesaPushPanel
            students={ctx.students}
            requests={ctx.requests}
            canPush={ctx.canInitiatePush}
            isActive={ctx.isActive}
          />
        )}
      </div>
    </ModulePageShell>
  );
}
