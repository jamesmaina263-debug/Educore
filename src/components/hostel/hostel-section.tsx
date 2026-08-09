"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
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

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Rooms</h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            {rooms.length} room{rooms.length === 1 ? "" : "s"}
          </span>
        </header>
        {rooms.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No rooms yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Room</th>
                  <th>Block</th>
                  <th>Gender</th>
                  <th>Occupancy</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.room_number}</td>
                    <td className="text-muted-foreground">{r.block ?? "—"}</td>
                    <td className="text-muted-foreground capitalize">{r.gender}</td>
                    <td>
                      <StatusBadge
                        tone={r.occupied >= r.capacity ? "warning" : "neutral"}
                        label={`${r.occupied} / ${r.capacity}`}
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
          <h2 className="text-[0.8125rem] font-semibold">Allocations</h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            {allocations.length} allocation{allocations.length === 1 ? "" : "s"}
          </span>
        </header>
        {allocations.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No allocations yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Student</th>
                  <th>Room</th>
                  <th>Since</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a) => (
                  <tr key={a.id}>
                    <td className="font-medium">{a.student_name}</td>
                    <td className="text-muted-foreground">{a.room_label}</td>
                    <td className="text-muted-foreground">{a.start_date}</td>
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
