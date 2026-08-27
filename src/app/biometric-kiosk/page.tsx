"use client";

// Biometric gate kiosk. Deliberately OUTSIDE the (app) route group: this
// page authenticates with a device key (localStorage), not a Supabase Auth
// session, and needs to keep working unattended on a gate tablet/PC long
// after any staff member's session that paired it has expired. See
// docs/OFFLINE_ROLLOUT.md, "Biometric gate kiosk" section, for the full
// architecture writeup.
//
// Two states:
//  - Unpaired: paste the device key issued once from Settings > Biometric
//    Devices (that page links here). A one-time, ideally-online,
//    desk-adjacent action -- the same category as every other
//    "Deliberately not queued" admin action across the offline rollout.
//  - Paired: the actual gate-scan flow, which IS offline-capable. There is
//    no real vendor SDK wired in yet (see the implementation summary), so
//    "Simulate scan" stands in for what a real device's local match would
//    hand this page: a credential_reference and nothing biometric.

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { queueMutation } from "@/lib/offline/queue";
import { fetchDeviceRoster, buildScanPayload, submitScan, type RosterEntry } from "@/lib/biometric/kiosk-client";
import { cacheRoster, getCachedRoster } from "@/lib/biometric/kiosk-cache";
import { subscribe, getSnapshot, getServerSnapshot, setDeviceKey } from "@/lib/biometric/kiosk-device-key-store";

const KIOSK_MODULE = "biometric-kiosk";

type LastScanState = { name: string; eventType: string; at: string; queued: boolean; dryRun: boolean } | null;

export default function BiometricKioskPage() {
  // useSyncExternalStore (not useEffect + setState-on-mount) reads
  // localStorage without a hydration-mismatch render -- see
  // kiosk-device-key-store.ts's header comment.
  const deviceKey = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return deviceKey ? (
    <PairedKiosk deviceKey={deviceKey} onUnpair={() => setDeviceKey(null)} />
  ) : (
    <PairingScreen onPaired={(key) => setDeviceKey(key)} />
  );
}

function KioskShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md space-y-6">{children}</div>
    </div>
  );
}

function PairingScreen({ onPaired }: { onPaired: (key: string) => void }) {
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePair() {
    const trimmed = key.trim();
    if (!trimmed.includes(".")) {
      setError("That doesn't look like a device key -- it should look like bio_xxxxxxxx.<secret>.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await fetchDeviceRoster(trimmed);
    setPending(false);
    if ("error" in result) {
      setError(
        result.error === "network"
          ? "Couldn't reach EduCore to verify this key -- check the connection and try again."
          : result.error,
      );
      return;
    }
    await cacheRoster(trimmed, result.deviceName, result.roster);
    onPaired(trimmed);
  }

  return (
    <KioskShell>
      <div className="space-y-1.5 text-center">
        <h1 className="text-lg font-semibold">Pair this device</h1>
        <p className="text-sm text-muted-foreground">
          Paste the device key shown once in Settings → Biometric Devices when this device was registered.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="device_key">Device key</Label>
        <Input
          id="device_key"
          placeholder="bio_xxxxxxxx.secret"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="font-mono text-xs"
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button className="w-full" onClick={handlePair} disabled={pending || !key.trim()}>
        {pending ? "Verifying…" : "Pair device"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Pairing needs a connection once. After that, this device keeps recording scans even if it goes offline.
      </p>
    </KioskShell>
  );
}

function PairedKiosk({ deviceKey, onUnpair }: { deviceKey: string; onUnpair: () => void }) {
  const online = useOnlineStatus();
  const { pendingCount, failed, syncing, sync, discard } = useOfflineSync(KIOSK_MODULE);

  const [deviceName, setDeviceName] = useState<string>("Biometric device");
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterStale, setRosterStale] = useState(false);
  const [selectedRef, setSelectedRef] = useState<string>("");
  const [eventType, setEventType] = useState<"check_in" | "check_out">("check_in");
  const [dryRun, setDryRun] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<LastScanState>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [confirmingUnpair, setConfirmingUnpair] = useState(false);

  // Defined inline (not as a separate useCallback referenced from the
  // effect) so the roster fetch stays a single self-contained async flow
  // per the effect's own lifecycle, including the `cancelled` guard below
  // -- the same shape use-offline-sync.ts's mount effect already uses.
  useEffect(() => {
    let cancelled = false;

    async function applyCachedRosterFallback() {
      const cached = await getCachedRoster(deviceKey);
      if (cancelled || !cached) return;
      setDeviceName(cached.deviceName);
      setRoster(cached.roster);
      setRosterStale(true);
    }

    async function run() {
      if (!online) {
        await applyCachedRosterFallback();
        return;
      }
      const result = await fetchDeviceRoster(deviceKey);
      if (cancelled) return;
      if ("error" in result) {
        await applyCachedRosterFallback(); // fall back to whatever was last cached rather than showing empty
        return;
      }
      setDeviceName(result.deviceName);
      setRoster(result.roster);
      setRosterStale(false);
      await cacheRoster(deviceKey, result.deviceName, result.roster);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [deviceKey, online]);

  async function handleScan() {
    if (!selectedRef) return;
    setScanning(true);
    setScanError(null);
    const entry = roster.find((r) => r.credential_reference === selectedRef);
    const payload = buildScanPayload({
      deviceKey,
      result: "success",
      credentialReference: selectedRef,
      eventType,
      dryRun,
    });

    if (online) {
      try {
        const result = await submitScan(payload);
        if ("error" in result) {
          setScanError(result.error);
        } else {
          setLastScan({ name: entry?.person_name ?? "Unknown", eventType, at: payload.occurred_at, queued: false, dryRun });
        }
      } catch {
        // A live TypeError mid-scan means we went offline between the
        // online check and the fetch -- queue it rather than lose it.
        await queueMutation(KIOSK_MODULE, "submitScan", payload);
        setLastScan({ name: entry?.person_name ?? "Unknown", eventType, at: payload.occurred_at, queued: true, dryRun });
      }
    } else {
      await queueMutation(KIOSK_MODULE, "submitScan", payload);
      setLastScan({ name: entry?.person_name ?? "Unknown", eventType, at: payload.occurred_at, queued: true, dryRun });
    }
    setScanning(false);
  }

  return (
    <KioskShell>
      <div className="space-y-1.5 text-center">
        <div className="flex items-center justify-center gap-2">
          <h1 className="text-lg font-semibold">{deviceName}</h1>
          <Badge variant={online ? "default" : "secondary"}>{online ? "Online" : "Offline"}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {pendingCount > 0
            ? `${pendingCount} scan${pendingCount === 1 ? "" : "s"} waiting to sync${syncing ? " — syncing now…" : ""}.`
            : "All scans synced."}
        </p>
      </div>

      {rosterStale && (
        <p className="rounded-md bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
          Showing the roster as of the last time this device was online — it may not reflect very recent enrollments.
        </p>
      )}

      <div className="space-y-1.5">
        <Label>Who scanned?</Label>
        <Select value={selectedRef} onValueChange={setSelectedRef}>
          <SelectTrigger>
            <SelectValue placeholder={roster.length === 0 ? "No enrolled credentials yet" : "Select a person"} />
          </SelectTrigger>
          <SelectContent>
            {roster.map((r) => (
              <SelectItem key={r.credential_reference} value={r.credential_reference}>
                {r.person_name} ({r.person_type}, {r.credential_type})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Event</Label>
        <Select value={eventType} onValueChange={(v) => setEventType(v as "check_in" | "check_out")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="check_in">Check in</SelectItem>
            <SelectItem value="check_out">Check out</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
        Dry run (skip guardian SMS — for testing against a real enrolled student)
      </label>

      {scanError && <p className="text-sm text-danger">{scanError}</p>}

      <Button className="w-full" size="lg" disabled={!selectedRef || scanning} onClick={handleScan}>
        {scanning ? "Recording…" : "Simulate scan"}
      </Button>

      {lastScan && (
        <p className="text-center text-xs text-muted-foreground">
          Last: {lastScan.name} — {lastScan.eventType === "check_in" ? "check-in" : "check-out"} at{" "}
          {new Date(lastScan.at).toLocaleTimeString()}
          {lastScan.queued && " (saved offline, will sync)"}
          {lastScan.dryRun && " · dry run"}
        </p>
      )}

      {failed.length > 0 && (
        <div className="space-y-1 rounded-md border border-danger/30 bg-danger/5 p-3">
          <p className="text-xs font-medium text-danger">{failed.length} scan(s) failed to sync and won&apos;t retry automatically:</p>
          {failed.map((m) => (
            <div key={m.id} className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{m.last_error ?? "Unknown error"}</span>
              <Button variant="ghost" size="sm" onClick={() => discard(m.id)}>
                Dismiss
              </Button>
            </div>
          ))}
        </div>
      )}

      {pendingCount > 0 && online && !syncing && (
        <Button variant="outline" size="sm" className="w-full" onClick={sync}>
          Retry sync now
        </Button>
      )}

      <div className="border-t pt-4 text-center">
        {confirmingUnpair ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Unpairing clears the device key from this browser. Any scans still waiting to sync stay queued.
            </p>
            <div className="flex justify-center gap-2">
              <Button variant="destructive" size="sm" onClick={onUnpair}>
                Confirm unpair
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingUnpair(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setConfirmingUnpair(true)}
          >
            Unpair this device
          </button>
        )}
      </div>
    </KioskShell>
  );
}
