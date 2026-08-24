import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { BiometricDevicesPanel } from "@/components/settings/biometric-devices-panel";
import { registerBiometricDevice, setBiometricDeviceStatus } from "@/app/(app)/settings/actions";

export default async function SettingsBiometricDevicesPage() {
  const ctx = await loadSettingsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Biometric Devices"
      title="Settings"
      noAccess={!ctx.canManageBiometricDevices}
    >
      <BiometricDevicesPanel
        rows={ctx.biometricDeviceRows}
        canManage
        registerAction={registerBiometricDevice}
        setStatusAction={setBiometricDeviceStatus}
      />
    </ModulePageShell>
  );
}
