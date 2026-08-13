"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  createRouteAction,
  createVehicleAction,
  createStopAction,
  assignTransportAction,
  endTransportAssignmentAction,
} from "@/app/transport/actions";

export interface RouteRow {
  id: string;
  name: string;
  description: string | null;
  fee_amount: number;
  capacity: number;
  allocated: number;
  available: number;
}

export interface VehicleRow {
  id: string;
  registration_number: string;
  capacity: number;
  route_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  conductor_name: string | null;
  conductor_phone: string | null;
  driver_license_number: string | null;
  driver_license_expiry: string | null;
  insurance_expiry: string | null;
  inspection_expiry: string | null;
  status: "active" | "maintenance" | "inactive";
}

export interface StopRow {
  id: string;
  route_id: string;
  name: string;
  sequence: number;
  pickup_time: string | null;
  capacity: number | null;
  allocated: number;
  available: number | null;
}

export interface AssignmentRow {
  id: string;
  student_name: string;
  route_name: string;
  vehicle_reg: string | null;
  stop_name: string | null;
  pickup_point: string | null;
  start_date: string;
  status: "active" | "ended";
}

export interface StudentOption {
  id: string;
  name: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Vehicle document expiry -> badge tone/label. No date = "Not set" (neutral), not an error state. */
function expiryStatus(dateStr: string | null): { tone: "success" | "warning" | "danger" | "neutral"; label: string } {
  if (!dateStr) return { tone: "neutral", label: "Not set" };
  const days = Math.floor((new Date(dateStr).getTime() - Date.now()) / DAY_MS);
  if (days < 0) return { tone: "danger", label: "Expired" };
  if (days <= 30) return { tone: "warning", label: `${days}d left` };
  return { tone: "success", label: "Valid" };
}

function capacityTone(capacity: number, available: number): "success" | "warning" | "neutral" {
  if (capacity <= 0) return "neutral";
  if (available <= 0) return "warning";
  return "success";
}

export function TransportSection({
  routes,
  vehicles,
  stops,
  assignments,
  studentOptions,
  canWrite,
}: {
  routes: RouteRow[];
  vehicles: VehicleRow[];
  stops: StopRow[];
  assignments: AssignmentRow[];
  studentOptions: StudentOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [routeOpen, setRouteOpen] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [routeFee, setRouteFee] = useState("");

  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [regNumber, setRegNumber] = useState("");
  const [capacity, setCapacity] = useState("");
  const [vehicleRouteId, setVehicleRouteId] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [conductorName, setConductorName] = useState("");
  const [conductorPhone, setConductorPhone] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [insuranceExpiry, setInsuranceExpiry] = useState("");
  const [inspectionExpiry, setInspectionExpiry] = useState("");

  const [stopOpen, setStopOpen] = useState(false);
  const [stopRouteId, setStopRouteId] = useState("");
  const [stopName, setStopName] = useState("");
  const [stopSequence, setStopSequence] = useState("1");
  const [stopCapacity, setStopCapacity] = useState("");
  const [stopTime, setStopTime] = useState("");

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignStudentId, setAssignStudentId] = useState("");
  const [assignRouteId, setAssignRouteId] = useState("");
  const [assignVehicleId, setAssignVehicleId] = useState("");
  const [assignStopId, setAssignStopId] = useState("");
  const [pickupPoint, setPickupPoint] = useState("");

  const stopsForAssignRoute = useMemo(() => stops.filter((s) => s.route_id === assignRouteId), [stops, assignRouteId]);
  const vehiclesForAssignRoute = useMemo(() => vehicles.filter((v) => v.route_id === assignRouteId), [vehicles, assignRouteId]);

  async function handleCreateRoute() {
    setPending(true);
    setError(null);
    const result = await createRouteAction({ name: routeName, fee_amount: Number(routeFee || 0) });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setRouteOpen(false);
    setRouteName("");
    setRouteFee("");
    router.refresh();
  }

  async function handleCreateVehicle() {
    setPending(true);
    setError(null);
    const result = await createVehicleAction({
      registration_number: regNumber,
      capacity: Number(capacity),
      route_id: vehicleRouteId || undefined,
      driver_name: driverName,
      driver_phone: driverPhone,
      conductor_name: conductorName,
      conductor_phone: conductorPhone,
      driver_license_number: licenseNumber,
      driver_license_expiry: licenseExpiry || undefined,
      insurance_expiry: insuranceExpiry || undefined,
      inspection_expiry: inspectionExpiry || undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setVehicleOpen(false);
    setRegNumber("");
    setCapacity("");
    setVehicleRouteId("");
    setDriverName("");
    setDriverPhone("");
    setConductorName("");
    setConductorPhone("");
    setLicenseNumber("");
    setLicenseExpiry("");
    setInsuranceExpiry("");
    setInspectionExpiry("");
    router.refresh();
  }

  async function handleCreateStop() {
    setPending(true);
    setError(null);
    const result = await createStopAction({
      route_id: stopRouteId,
      name: stopName,
      sequence: Number(stopSequence || 1),
      pickup_time: stopTime || undefined,
      capacity: stopCapacity ? Number(stopCapacity) : undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setStopOpen(false);
    setStopRouteId("");
    setStopName("");
    setStopSequence("1");
    setStopCapacity("");
    setStopTime("");
    router.refresh();
  }

  async function handleAssign() {
    setPending(true);
    setError(null);
    const result = await assignTransportAction({
      student_id: assignStudentId,
      route_id: assignRouteId,
      vehicle_id: assignVehicleId || undefined,
      stop_id: assignStopId || undefined,
      pickup_point: pickupPoint || undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setAssignOpen(false);
    setAssignStudentId("");
    setAssignRouteId("");
    setAssignVehicleId("");
    setAssignStopId("");
    setPickupPoint("");
    router.refresh();
  }

  async function handleEnd(id: string) {
    setPending(true);
    const result = await endTransportAssignmentAction(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-3">
              <h2 className="text-[0.8125rem] font-semibold">Routes</h2>
              <span className="text-[0.6875rem] text-muted-foreground">
                {routes.length} route{routes.length === 1 ? "" : "s"}
              </span>
            </div>
            {canWrite && (
              <Dialog open={routeOpen} onOpenChange={setRouteOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    Add route
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add a route</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>Name</Label>
                      <Input value={routeName} onChange={(e) => setRouteName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Fee (KES, per term)</Label>
                      <Input type="number" value={routeFee} onChange={(e) => setRouteFee(e.target.value)} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleCreateRoute} disabled={pending || !routeName}>
                      {pending ? "Adding…" : "Add"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </header>
          {routes.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No routes yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-dense w-full">
                <thead className="bg-muted/70">
                  <tr>
                    <th>Name</th>
                    <th className="text-right">Fee</th>
                    <th>Capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.name}</td>
                      <td className="text-right" data-numeric>
                        {r.fee_amount.toLocaleString()}
                      </td>
                      <td>
                        <StatusBadge
                          tone={capacityTone(r.capacity, r.available)}
                          label={r.capacity > 0 ? `${r.allocated}/${r.capacity} — ${r.available} free` : "Not configured"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-3">
              <h2 className="text-[0.8125rem] font-semibold">Vehicles</h2>
              <span className="text-[0.6875rem] text-muted-foreground">
                {vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"}
              </span>
            </div>
            {canWrite && (
              <Dialog open={vehicleOpen} onOpenChange={setVehicleOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    Add vehicle
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Add a vehicle</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Registration number</Label>
                        <Input value={regNumber} onChange={(e) => setRegNumber(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Capacity</Label>
                        <Input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Route</Label>
                      <Select value={vehicleRouteId} onValueChange={setVehicleRouteId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          {routes.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Driver name</Label>
                        <Input value={driverName} onChange={(e) => setDriverName(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Driver phone</Label>
                        <Input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Conductor name</Label>
                        <Input value={conductorName} onChange={(e) => setConductorName(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Conductor phone</Label>
                        <Input value={conductorPhone} onChange={(e) => setConductorPhone(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Driver licence number</Label>
                      <Input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Licence expiry</Label>
                        <Input type="date" value={licenseExpiry} onChange={(e) => setLicenseExpiry(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Insurance expiry</Label>
                        <Input type="date" value={insuranceExpiry} onChange={(e) => setInsuranceExpiry(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Inspection expiry</Label>
                        <Input type="date" value={inspectionExpiry} onChange={(e) => setInspectionExpiry(e.target.value)} />
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleCreateVehicle} disabled={pending || !regNumber || !capacity}>
                      {pending ? "Adding…" : "Add"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </header>
          {vehicles.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No vehicles yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-dense w-full">
                <thead className="bg-muted/70">
                  <tr>
                    <th>Reg. number</th>
                    <th>Capacity</th>
                    <th>Driver / Conductor</th>
                    <th>Licence</th>
                    <th>Insurance</th>
                    <th>Inspection</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map((v) => {
                    const lic = expiryStatus(v.driver_license_expiry);
                    const ins = expiryStatus(v.insurance_expiry);
                    const insp = expiryStatus(v.inspection_expiry);
                    return (
                      <tr key={v.id}>
                        <td className="font-medium">{v.registration_number}</td>
                        <td data-numeric>{v.capacity}</td>
                        <td className="text-muted-foreground">
                          {v.driver_name ?? "—"}
                          {v.conductor_name ? ` / ${v.conductor_name}` : ""}
                        </td>
                        <td>
                          <StatusBadge tone={lic.tone} label={lic.label} />
                        </td>
                        <td>
                          <StatusBadge tone={ins.tone} label={ins.label} />
                        </td>
                        <td>
                          <StatusBadge tone={insp.tone} label={insp.label} />
                        </td>
                        <td>
                          <StatusBadge tone={v.status === "active" ? "success" : v.status === "maintenance" ? "warning" : "neutral"} label={v.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-3">
            <h2 className="text-[0.8125rem] font-semibold">Stops</h2>
            <span className="text-[0.6875rem] text-muted-foreground">
              {stops.length} stop{stops.length === 1 ? "" : "s"}
            </span>
          </div>
          {canWrite && (
            <Dialog open={stopOpen} onOpenChange={setStopOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  Add stop
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add a stop</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Route</Label>
                    <Select value={stopRouteId} onValueChange={setStopRouteId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select route" />
                      </SelectTrigger>
                      <SelectContent>
                        {routes.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Stop name</Label>
                    <Input value={stopName} onChange={(e) => setStopName(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label>Order</Label>
                      <Input type="number" value={stopSequence} onChange={(e) => setStopSequence(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Pickup time</Label>
                      <Input type="time" value={stopTime} onChange={(e) => setStopTime(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Capacity (optional)</Label>
                      <Input type="number" value={stopCapacity} onChange={(e) => setStopCapacity(e.target.value)} />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleCreateStop} disabled={pending || !stopRouteId || !stopName}>
                    {pending ? "Adding…" : "Add"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </header>
        {stops.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No stops configured yet — assignments will use a free-text pickup point.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Route</th>
                  <th>Stop</th>
                  <th>Pickup time</th>
                  <th>Capacity</th>
                </tr>
              </thead>
              <tbody>
                {stops.map((s) => (
                  <tr key={s.id}>
                    <td className="text-muted-foreground">{routes.find((r) => r.id === s.route_id)?.name ?? "—"}</td>
                    <td className="font-medium">{s.name}</td>
                    <td className="text-muted-foreground">{s.pickup_time ?? "—"}</td>
                    <td>
                      {s.capacity ? (
                        <StatusBadge tone={s.available !== null && s.available <= 0 ? "warning" : "success"} label={`${s.allocated}/${s.capacity}`} />
                      ) : (
                        <StatusBadge tone="neutral" label="Unlimited" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-3">
            <h2 className="text-[0.8125rem] font-semibold">Student assignments</h2>
            <span className="text-[0.6875rem] text-muted-foreground">
              {assignments.length} assignment{assignments.length === 1 ? "" : "s"}
            </span>
          </div>
          {canWrite && (
            <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
              <DialogTrigger asChild>
                <Button size="sm">Assign student</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Assign a student to a route</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Student</Label>
                    <Select value={assignStudentId} onValueChange={setAssignStudentId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select student" />
                      </SelectTrigger>
                      <SelectContent>
                        {studentOptions.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Route</Label>
                    <Select
                      value={assignRouteId}
                      onValueChange={(v) => {
                        setAssignRouteId(v);
                        setAssignStopId("");
                        setAssignVehicleId("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select route" />
                      </SelectTrigger>
                      <SelectContent>
                        {routes.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name} {r.capacity > 0 ? `(${r.available} free)` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {vehiclesForAssignRoute.length > 0 && (
                    <div className="space-y-1.5">
                      <Label>Vehicle (optional)</Label>
                      <Select value={assignVehicleId} onValueChange={setAssignVehicleId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Any vehicle on this route" />
                        </SelectTrigger>
                        <SelectContent>
                          {vehiclesForAssignRoute.map((v) => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.registration_number}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {stopsForAssignRoute.length > 0 ? (
                    <div className="space-y-1.5">
                      <Label>Stop</Label>
                      <Select value={assignStopId} onValueChange={setAssignStopId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select stop" />
                        </SelectTrigger>
                        <SelectContent>
                          {stopsForAssignRoute.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name} {s.capacity ? `(${s.available} free)` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label>Pickup point</Label>
                      <Input value={pickupPoint} onChange={(e) => setPickupPoint(e.target.value)} placeholder="No stops configured for this route yet" />
                    </div>
                  )}
                  <p className="text-[0.75rem] text-muted-foreground">Any existing active assignment for this student ends automatically.</p>
                </div>
                <DialogFooter>
                  <Button onClick={handleAssign} disabled={pending || !assignStudentId || !assignRouteId}>
                    {pending ? "Assigning…" : "Assign"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </header>
        {assignments.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No assignments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Student</th>
                  <th>Route</th>
                  <th>Vehicle</th>
                  <th>Stop / Pickup point</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td className="font-medium">{a.student_name}</td>
                    <td className="text-muted-foreground">{a.route_name}</td>
                    <td className="text-muted-foreground">{a.vehicle_reg ?? "—"}</td>
                    <td className="text-muted-foreground">{a.stop_name ?? a.pickup_point ?? "—"}</td>
                    <td>
                      <StatusBadge tone={a.status === "active" ? "success" : "neutral"} label={a.status} />
                    </td>
                    <td className="text-right">
                      {canWrite && a.status === "active" && (
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleEnd(a.id)}>
                          End
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
