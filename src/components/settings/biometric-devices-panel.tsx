"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

export interface BiometricDeviceRow {
  id: string;
  name: string;
  device_type: "fingerprint" | "face" | "card" | "other";
  provider: string;
  location: string | null;
  api_key_prefix: string | null;
  status: "active" | "inactive";
  last_seen_at: string | null;
  created_at: string;
}

type RegisterInput = { name: string; device_type: string; provider: string; location: string; serial_number: string };
type RegisterResult = { error: string } | { success: true; raw_key: string; key_prefix: string };
type StatusResult = { error: string } | { success: true };

export function BiometricDevicesPanel({
  rows,
  canManage,
  registerAction,
  setStatusAction,
}: {
  rows: BiometricDeviceRow[];
  canManage: boolean;
  registerAction: (input: RegisterInput) => Promise<RegisterResult>;
  setStatusAction: (id: string, status: "active" | "inactive") => Promise<StatusResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [deviceType, setDeviceType] = useState("fingerprint");
  const [provider, setProvider] = useState("generic");
  const [location, setLocation] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function handleRegister() {
    if (!name.trim()) {
      setError("Give the device a name (e.g. the gate it sits at).");
      return;
    }
    setPending(true);
    setError(null);
    const result = await registerAction({
      name: name.trim(),
      device_type: deviceType,
      provider: provider.trim() || "generic",
      location: location.trim(),
      serial_number: serialNumber.trim(),
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setIssuedKey(result.raw_key);
    router.refresh();
  }

  function handleClose(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setName("");
      setDeviceType("fingerprint");
      setProvider("generic");
      setLocation("");
      setSerialNumber("");
      setIssuedKey(null);
      setError(null);
    }
  }

  async function handleToggle(row: BiometricDeviceRow) {
    setTogglingId(row.id);
    await setStatusAction(row.id, row.status === "active" ? "inactive" : "active");
    setTogglingId(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="label-eyebrow">
          {rows.length} device{rows.length === 1 ? "" : "s"}
        </p>
        {canManage && (
          <Dialog open={open} onOpenChange={handleClose}>
            <DialogTrigger asChild>
              <Button size="sm">Register device</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{issuedKey ? "Device registered" : "Register a biometric device"}</DialogTitle>
              </DialogHeader>

              {issuedKey ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Copy this now — it won&apos;t be shown again. EduCore only stores a hash of it. Configure it on the physical
                    device (or the bridge script/kiosk pointed at it) as its bearer credential.
                  </p>
                  <code className="block break-all rounded bg-muted p-3 text-xs">{issuedKey}</code>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="device_name">Name</Label>
                    <Input id="device_name" placeholder="e.g. Main Gate" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <Select value={deviceType} onValueChange={setDeviceType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fingerprint">Fingerprint</SelectItem>
                        <SelectItem value="face">Face</SelectItem>
                        <SelectItem value="card">Card</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="device_provider">Provider (optional)</Label>
                    <Input
                      id="device_provider"
                      placeholder="e.g. zkteco, hikvision — leave as generic if unsure"
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="device_location">Location (optional)</Label>
                    <Input
                      id="device_location"
                      placeholder="e.g. Main entrance"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="device_serial">Serial number (optional)</Label>
                    <Input id="device_serial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
                  </div>
                  {error && <p className="text-sm text-danger">{error}</p>}
                </div>
              )}

              <DialogFooter>
                {issuedKey ? (
                  <Button onClick={() => handleClose(false)}>Done</Button>
                ) : (
                  <Button onClick={handleRegister} disabled={pending}>
                    {pending ? "Registering…" : "Register"}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No biometric devices registered yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last seen</TableHead>
              {canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div>{row.name}</div>
                  {row.api_key_prefix && <code className="text-xs text-muted-foreground">{row.api_key_prefix}…</code>}
                </TableCell>
                <TableCell className="capitalize">{row.device_type}</TableCell>
                <TableCell>{row.provider}</TableCell>
                <TableCell>{row.location ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={row.status === "active" ? "default" : "secondary"}>{row.status}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.last_seen_at ? new Date(row.last_seen_at).toLocaleString() : "Never"}
                </TableCell>
                {canManage && (
                  <TableCell>
                    <Button variant="ghost" size="sm" disabled={togglingId === row.id} onClick={() => handleToggle(row)}>
                      {togglingId === row.id ? "Saving…" : row.status === "active" ? "Deactivate" : "Reactivate"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="text-xs text-muted-foreground">
        Deactivating a device immediately stops it from verifying anyone or recording attendance — biometric-verify checks device
        status on every request. Registered devices never store or transmit a fingerprint/face image, raw template, or embedding;
        they report only which of their own enrolled reference IDs matched.
      </p>
    </div>
  );
}
