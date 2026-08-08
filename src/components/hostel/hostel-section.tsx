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
import { createHostelRoomAction, allocateHostelRoomAction, endHostelAllocationAction } from "@/app/hostel/actions";

export interface RoomRow {
  id: string;
  room_number: string;
  block: string | null;
  capacity: number;
  gender: "male" | "female" | "mixed";
  occupied: number;
}

export interface AllocationRow {
  id: string;
  student_name: string;
  room_label: string;
  start_date: string;
  status: "active" | "ended";
}

export interface StudentOption {
  id: string;
  name: string;
}

export function HostelSection({
  rooms,
  allocations,
  studentOptions,
  canWrite,
}: {
  rooms: RoomRow[];
  allocations: AllocationRow[];
  studentOptions: StudentOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [roomOpen, setRoomOpen] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [block, setBlock] = useState("");
  const [capacity, setCapacity] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "mixed">("mixed");

  const [allocOpen, setAllocOpen] = useState(false);
  const [allocStudentId, setAllocStudentId] = useState("");
  const [allocRoomId, setAllocRoomId] = useState("");

  async function handleCreateRoom() {
    setPending(true);
    setError(null);
    const result = await createHostelRoomAction({ room_number: roomNumber, block, capacity: Number(capacity), gender });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setRoomOpen(false);
    setRoomNumber("");
    setBlock("");
    setCapacity("");
    setGender("mixed");
    router.refresh();
  }

  async function handleAllocate() {
    setPending(true);
    setError(null);
    const result = await allocateHostelRoomAction({ student_id: allocStudentId, hostel_room_id: allocRoomId });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setAllocOpen(false);
    setAllocStudentId("");
    setAllocRoomId("");
    router.refresh();
  }

  async function handleEnd(id: string) {
    setPending(true);
    const result = await endHostelAllocationAction(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-danger">{error}</p>}

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Dialog open={roomOpen} onOpenChange={setRoomOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Add room
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a hostel room</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Room number</Label>
                    <Input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Block</Label>
                    <Input value={block} onChange={(e) => setBlock(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Capacity</Label>
                    <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Gender</Label>
                    <Select value={gender} onValueChange={(v) => setGender(v as "male" | "female" | "mixed")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="mixed">Mixed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleCreateRoom} disabled={pending || !roomNumber || !capacity}>
                  {pending ? "Adding…" : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={allocOpen} onOpenChange={setAllocOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Allocate student</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Allocate a room</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Student</Label>
                  <Select value={allocStudentId} onValueChange={setAllocStudentId}>
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
                  <Label>Room</Label>
                  <Select value={allocRoomId} onValueChange={setAllocRoomId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select room" />
                    </SelectTrigger>
                    <SelectContent>
                      {rooms
                        .filter((r) => r.occupied < r.capacity)
                        .map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.block ? `${r.block} ` : ""}
                            {r.room_number} ({r.occupied}/{r.capacity})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">Any existing active allocation for this student ends automatically.</p>
              </div>
              <DialogFooter>
                <Button onClick={handleAllocate} disabled={pending || !allocStudentId || !allocRoomId}>
                  {pending ? "Allocating…" : "Allocate"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Rooms</h2>
        {rooms.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No rooms yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Room</TableHead>
                <TableHead>Block</TableHead>
                <TableHead>Gender</TableHead>
                <TableHead>Occupancy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.room_number}</TableCell>
                  <TableCell>{r.block ?? "—"}</TableCell>
                  <TableCell className="capitalize">{r.gender}</TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={r.occupied >= r.capacity ? "warning" : "neutral"}
                      label={`${r.occupied} / ${r.capacity}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Allocations</h2>
        {allocations.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No allocations yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Since</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocations.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.student_name}</TableCell>
                  <TableCell>{a.room_label}</TableCell>
                  <TableCell>{a.start_date}</TableCell>
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
