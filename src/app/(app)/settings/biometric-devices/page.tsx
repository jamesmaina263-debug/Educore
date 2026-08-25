import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { BiometricDevicesPanel } from "@/components/settings/biometric-devices-panel";
import { GateLatenessPanel } from "@/components/settings/gate-lateness-panel";
import { PendingEnrollmentsPanel } from "@/components/settings/pending-enrollments-panel";
import {
  registerBiometricDevice,
  setBiometricDeviceStatus,
  updateGateLateThresholds,
  searchPeopleForBiometricLink,
  linkBiometricEnrollmentEvent,
  ignoreBiometricEnrollmentEvent,
} from "@/app/(app)/settings/actions";

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
      <GateLatenessPanel initial={ctx.gateLateThresholds} canManage={ctx.canManageBiometricDevices} updateAction={updateGateLateThresholds} />
      <PendingEnrollmentsPanel
        rows={ctx.pendingEnrollmentRows}
        canManage={ctx.canManageBiometricDevices}
        searchAction={searchPeopleForBiometricLink}
        linkAction={linkBiometricEnrollmentEvent}
        ignoreAction={ignoreBiometricEnrollmentEvent}
      />
      <p className="mt-4 text-xs text-muted-foreground">
        Once a device key is issued above, open{" "}
        <a href="/biometric-kiosk" target="_blank" rel="noopener noreferrer" className="underline">
          /biometric-kiosk
        </a>{" "}
        on the gate device and paste the key there to pair it. That page runs outside staff sign-in — it authenticates
        with the device key alone, so it keeps recording scans (including while offline) even after this session ends.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        For push-protocol devices (e.g. ZKTeco), point the device at <code>/iclock/cdata</code> on this domain instead — it
        authenticates by serial number (and an optional comm key, set on the device row above) rather than the kiosk&apos;s
        device key.
      </p>
    </ModulePageShell>
  );
}
