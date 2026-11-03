"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDriverCodeAction, revokeDriverCodeAction } from "@/app/(app)/transport/devices/actions";

export interface VehicleOption { id: string; registration: string }
export interface DeviceRow { id: string; vehicleId: string; label: string; active: boolean; lastSeenAt: string | null; createdAt: string }

export function DriverCodesSection({ vehicles, devices }: { vehicles: VehicleOption[]; devices: DeviceRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [label, setLabel] = useState("Driver phone");
  const [message, setMessage] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ token: string; vehicle: string } | null>(null);
  const regById = new Map(vehicles.map((v) => [v.id, v.registration]));

  function create() {
    setMessage(null);
    setIssued(null);
    start(async () => {
      const r = await createDriverCodeAction(vehicleId, label);
      if ("error" in r) setMessage(r.error);
      else { setIssued({ token: r.token, vehicle: regById.get(vehicleId) ?? "" }); router.refresh(); }
    });
  }

  function revoke(id: string) {
    setMessage(null);
    start(async () => {
      const r = await revokeDriverCodeAction(id);
      if ("error" in r) setMessage(r.error);
      else router.refresh();
    });
  }

  const link = typeof window === "undefined" ? "/portal/driver" : `${window.location.origin}/portal/driver`;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        A driver code lets one phone share a vehicle&apos;s location. It is shown once, then only a fingerprint is kept. Revoke a code the moment a phone is lost or a driver leaves.
      </p>
      {message && <p role="alert" className="panel border-destructive p-3 text-destructive">{message}</p>}

      <div className="panel flex flex-wrap items-end gap-2 p-3">
        <label>
          <span className="block font-medium">Vehicle</span>
          <select className="mt-1 rounded border bg-background px-2 py-1" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration}</option>)}
          </select>
        </label>
        <label>
          <span className="block font-medium">Label</span>
          <input className="mt-1 w-48 rounded border bg-background px-2 py-1" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button type="button" className="rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" disabled={pending || !vehicleId} onClick={create}>Create driver code</button>
      </div>

      {issued && (
        <div className="panel space-y-2 border-primary p-3" role="status">
          <p className="font-medium">Code for {issued.vehicle} — copy it now, it will not be shown again.</p>
          <p className="break-all rounded bg-muted p-2 font-mono text-xs select-all">{issued.token}</p>
          <p className="text-muted-foreground">The driver opens <span className="font-mono">{link}</span> on their phone, pastes this code once, and taps Start.</p>
        </div>
      )}

      <div className="panel overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-3 py-2">Vehicle</th><th className="px-3 py-2">Label</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Last seen</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No driver codes yet.</td></tr>
            ) : devices.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="px-3 py-2">{regById.get(d.vehicleId) ?? "—"}</td>
                <td className="px-3 py-2">{d.label}</td>
                <td className="px-3 py-2">{d.active ? "Active" : "Revoked"}</td>
                <td className="px-3 py-2" data-numeric>{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "Never"}</td>
                <td className="px-3 py-2 text-right">{d.active && <button type="button" className="underline disabled:opacity-50" disabled={pending} onClick={() => revoke(d.id)}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
