"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createRouteAction, createVehicleAction, assignTransportAction, endTransportAssignmentAction } from "@/app/transport/actions";

export interface RouteRow {
  id: string;
  name: string;
  description: string | null;
  fee_amount: number;
}

export interface VehicleRow {
  id: string;
  registration_number: string;
  capacity: number;
  driver_name: string | null;
  driver_phone: string | null;
}

export interface AssignmentRow {
  id: string;
  student_name: string;
  route_name: string;
  pickup_point: string | null;
  start_date: string;
  status: "active" | "ended";
}

export interface StudentOption {
  id: string;
  name: string;
}

export function TransportSection({
  routes,
  vehicles,
  assignments,
  studentOptions,
  canWrite,
}: {
  routes: RouteRow[];
  vehicles: VehicleRow[];
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
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignStudentId, setAssignStudentId] = useState("");
  const [assignRouteId, setAssignRouteId] = useState("");
  const [pickupPoint, setPickupPoint] = useState("");

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
      driver_name: driverName,
      driver_phone: driverPhone,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setVehicleOpen(false);
    setRegNumber("");
    setCapacity("");
    setDriverName("");
    setDriverPhone("");
    router.refresh();
  }

  async function handleAssign() {
    setPending(true);
    setError(null);
    const result = await assignTransportAction({ student_id: assignStudentId, route_id: assignRouteId, pickup_point: pickupPoint });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setAssignOpen(false);
    setAssignStudentId("");
    setAssignRouteId("");
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

      {canWrite && (
        <div className="flex flex-wrap gap-2">
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

          <Dialog open={vehicleOpen} onOpenChange={setVehicleOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Add vehicle
              </Button>
            </DialogTrigger>
            <DialogContent>
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
              </div>
              <DialogFooter>
                <Button onClick={handleCreateVehicle} disabled={pending || !regNumber || !capacity}>
                  {pending ? "Adding…" : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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
                  <Select value={assignRouteId} onValueChange={setAssignRouteId}>
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
                  <Label>Pickup point</Label>
                  <Input value={pickupPoint} onChange={(e) => setPickupPoint(e.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground">Any existing active assignment for this student ends automatically.</p>
              </div>
              <DialogFooter>
                <Button onClick={handleAssign} disabled={pending || !assignStudentId || !assignRouteId}>
                  {pending ? "Assigning…" : "Assign"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Routes</h2>
          {routes.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No routes yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Fee</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.fee_amount.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Vehicles</h2>
          {vehicles.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No vehicles yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reg. number</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Driver</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.registration_number}</TableCell>
                    <TableCell>{v.capacity}</TableCell>
                    <TableCell>{v.driver_name ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Student assignments</h2>
        {assignments.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No assignments yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Pickup point</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.student_name}</TableCell>
                  <TableCell>{a.route_name}</TableCell>
                  <TableCell>{a.pickup_point ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge tone={a.status === "active" ? "success" : "neutral"} label={a.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {canWrite && a.status === "active" && (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleEnd(a.id)}>
                        End
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
