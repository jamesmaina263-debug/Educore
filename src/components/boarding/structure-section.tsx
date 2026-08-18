"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBoardingHouse, createDormitory, createRoom, setBedStatus } from "@/app/(app)/boarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export interface StaffOption {
  id: string;
  full_name: string;
}

export interface BedRow {
  id: string;
  bed_number: string;
  status: "available" | "reserved" | "unavailable";
  occupant_name: string | null;
}

export interface RoomRow {
  id: string;
  room_number: string;
  capacity: number;
  gender: "male" | "female" | "mixed";
  beds: BedRow[];
}

export interface DormitoryRow {
  id: string;
  name: string;
  capacity: number | null;
  gender: "male" | "female" | "mixed";
  master_name: string | null;
  assistant_name: string | null;
  rooms: RoomRow[];
}

export interface HouseRow {
  id: string;
  name: string;
  description: string | null;
  gender: "male" | "female" | "mixed";
  capacity: number | null;
  master_name: string | null;
  assistant_name: string | null;
  dormitories: DormitoryRow[];
  // A room can attach directly to a house, skipping Dormitory entirely.
  direct_rooms: RoomRow[];
}

type Gender = "male" | "female" | "mixed";

const bedTone: Record<BedRow["status"], "success" | "danger" | "neutral"> = {
  available: "success",
  reserved: "neutral",
  unavailable: "danger",
};

function GenderSelect({ value, onChange }: { value: Gender; onChange: (g: Gender) => void }) {
  return (
    <Select value={value} onValueChange={(v: Gender) => onChange(v)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="male">Male</SelectItem>
        <SelectItem value="female">Female</SelectItem>
        <SelectItem value="mixed">Mixed</SelectItem>
      </SelectContent>
    </Select>
  );
}

function StaffSelect({
  staff,
  value,
  onChange,
  placeholder,
}: {
  staff: StaffOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Unassigned</SelectItem>
        {staff.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.full_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RoomCard({ room, canWrite, onToggleBed }: { room: RoomRow; canWrite: boolean; onToggleBed: (bed: BedRow) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        Room {room.room_number} — {room.beds.filter((b) => b.occupant_name).length}/{room.capacity} occupied
      </p>
      <div className="flex flex-wrap gap-1.5">
        {room.beds.map((bed) => (
          <span
            key={bed.id}
            title={bed.occupant_name ?? (canWrite ? "Click to toggle available/unavailable" : bed.status)}
            onClick={() => canWrite && onToggleBed(bed)}
            className={canWrite && !bed.occupant_name ? "cursor-pointer" : undefined}
          >
            <StatusBadge
              tone={bed.occupant_name ? "danger" : bedTone[bed.status]}
              label={bed.occupant_name ? `${bed.bed_number} · occupied` : `${bed.bed_number} · ${bed.status}`}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

export function StructureSection({
  houses,
  standaloneDormitories,
  standaloneRooms,
  staff,
  canWrite,
}: {
  houses: HouseRow[];
  standaloneDormitories: DormitoryRow[];
  standaloneRooms: RoomRow[];
  staff: StaffOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedHouse, setExpandedHouse] = useState<string | null>(houses[0]?.id ?? null);
  const [expandedDorm, setExpandedDorm] = useState<string | null>(null);

  const [houseOpen, setHouseOpen] = useState(false);
  const [houseForm, setHouseForm] = useState({ name: "", description: "", gender: "mixed" as Gender, capacity: "", master_id: "none", assistant_id: "none" });

  // null = closed. "standalone" = adding a dormitory with no parent house.
  // Any other string = adding a dormitory under that house's id.
  const [dormOpen, setDormOpen] = useState<string | null>(null);
  const [dormForm, setDormForm] = useState({ name: "", gender: "mixed" as Gender, capacity: "", master_id: "none", assistant_id: "none" });

  // null = closed. "standalone" = room under neither a house nor dormitory.
  // "house:<id>" = room directly under that house, skipping Dormitory.
  // Any other string = room under that dormitory's id.
  const [roomOpen, setRoomOpen] = useState<string | null>(null);
  const [roomForm, setRoomForm] = useState({ room_number: "", capacity: "", gender: "mixed" as Gender });

  async function submitHouse() {
    setPending(true);
    setError(null);
    const result = await createBoardingHouse({
      name: houseForm.name,
      description: houseForm.description || undefined,
      gender: houseForm.gender,
      capacity: houseForm.capacity ? Number(houseForm.capacity) : undefined,
      master_id: houseForm.master_id === "none" ? undefined : houseForm.master_id,
      assistant_id: houseForm.assistant_id === "none" ? undefined : houseForm.assistant_id,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setHouseOpen(false);
    setHouseForm({ name: "", description: "", gender: "mixed", capacity: "", master_id: "none", assistant_id: "none" });
    router.refresh();
  }

  async function submitDorm(houseId?: string) {
    setPending(true);
    setError(null);
    const result = await createDormitory({
      house_id: houseId,
      name: dormForm.name,
      gender: dormForm.gender,
      capacity: dormForm.capacity ? Number(dormForm.capacity) : undefined,
      master_id: dormForm.master_id === "none" ? undefined : dormForm.master_id,
      assistant_id: dormForm.assistant_id === "none" ? undefined : dormForm.assistant_id,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setDormOpen(null);
    setDormForm({ name: "", gender: "mixed", capacity: "", master_id: "none", assistant_id: "none" });
    router.refresh();
  }

  async function submitRoom(opts: { dormitory_id?: string; house_id?: string }) {
    setPending(true);
    setError(null);
    const result = await createRoom({
      dormitory_id: opts.dormitory_id,
      house_id: opts.house_id,
      room_number: roomForm.room_number,
      capacity: Number(roomForm.capacity),
      gender: roomForm.gender,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setRoomOpen(null);
    setRoomForm({ room_number: "", capacity: "", gender: "mixed" });
    router.refresh();
  }

  async function toggleBed(bed: BedRow) {
    if (bed.occupant_name) return; // can't administratively change status of an occupied bed here
    const next = bed.status === "available" ? "unavailable" : "available";
    setPending(true);
    await setBedStatus(bed.id, next);
    setPending(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      {canWrite && (
        <Dialog open={houseOpen} onOpenChange={setHouseOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="self-start">
              Add house
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New boarding house</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={houseForm.name} onChange={(e) => setHouseForm({ ...houseForm, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Description (optional)</Label>
                <Textarea value={houseForm.description} onChange={(e) => setHouseForm({ ...houseForm, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Gender</Label>
                  <GenderSelect value={houseForm.gender} onChange={(g) => setHouseForm({ ...houseForm, gender: g })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Capacity (optional)</Label>
                  <Input type="number" min={0} value={houseForm.capacity} onChange={(e) => setHouseForm({ ...houseForm, capacity: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>House master/mistress</Label>
                  <StaffSelect staff={staff} value={houseForm.master_id} onChange={(v) => setHouseForm({ ...houseForm, master_id: v })} placeholder="Unassigned" />
                </div>
                <div className="space-y-1.5">
                  <Label>Assistant staff</Label>
                  <StaffSelect staff={staff} value={houseForm.assistant_id} onChange={(v) => setHouseForm({ ...houseForm, assistant_id: v })} placeholder="Unassigned" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={submitHouse} disabled={pending || !houseForm.name}>
                {pending ? "Creating…" : "Create house"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {houses.length === 0 && (
        <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          No boarding houses yet. Add one to get started.
        </div>
      )}

      {houses.map((house) => (
        <div key={house.id} className="panel p-4">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setExpandedHouse(expandedHouse === house.id ? null : house.id)}
          >
            <div>
              <p className="font-medium">{house.name}</p>
              <p className="text-xs text-muted-foreground">
                {house.gender} · Master: {house.master_name ?? "Unassigned"}
                {house.assistant_name ? ` · Assistant: ${house.assistant_name}` : ""}
              </p>
            </div>
            <span className="text-muted-foreground">{expandedHouse === house.id ? "▾" : "▸"}</span>
          </button>

          {expandedHouse === house.id && (
            <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
              {canWrite && (
                <Dialog open={dormOpen === house.id} onOpenChange={(o) => setDormOpen(o ? house.id : null)}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="self-start">
                      Add dormitory
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>New dormitory in {house.name}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input value={dormForm.name} onChange={(e) => setDormForm({ ...dormForm, name: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Gender</Label>
                          <GenderSelect value={dormForm.gender} onChange={(g) => setDormForm({ ...dormForm, gender: g })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Capacity (optional)</Label>
                          <Input type="number" min={0} value={dormForm.capacity} onChange={(e) => setDormForm({ ...dormForm, capacity: e.target.value })} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Dormitory master/mistress</Label>
                          <StaffSelect staff={staff} value={dormForm.master_id} onChange={(v) => setDormForm({ ...dormForm, master_id: v })} placeholder="Unassigned" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Assistant staff</Label>
                          <StaffSelect staff={staff} value={dormForm.assistant_id} onChange={(v) => setDormForm({ ...dormForm, assistant_id: v })} placeholder="Unassigned" />
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={() => submitDorm(house.id)} disabled={pending || !dormForm.name}>
                        {pending ? "Creating…" : "Create dormitory"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              {house.dormitories.length === 0 && (
                <p className="text-sm text-muted-foreground">No dormitories yet.</p>
              )}

              {house.dormitories.map((dorm) => (
                <div key={dorm.id} className="rounded-md border border-border p-3">
                  <button
                    className="flex w-full items-center justify-between text-left"
                    onClick={() => setExpandedDorm(expandedDorm === dorm.id ? null : dorm.id)}
                  >
                    <div>
                      <p className="text-sm font-medium">{dorm.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {dorm.gender} · Master: {dorm.master_name ?? "Unassigned"}
                      </p>
                    </div>
                    <span className="text-muted-foreground">{expandedDorm === dorm.id ? "▾" : "▸"}</span>
                  </button>

                  {expandedDorm === dorm.id && (
                    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                      {canWrite && (
                        <Dialog open={roomOpen === dorm.id} onOpenChange={(o) => setRoomOpen(o ? dorm.id : null)}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline" className="self-start">
                              Add room
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>New room in {dorm.name}</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-3">
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                  <Label>Room number</Label>
                                  <Input value={roomForm.room_number} onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })} />
                                </div>
                                <div className="space-y-1.5">
                                  <Label>Capacity (beds)</Label>
                                  <Input type="number" min={1} value={roomForm.capacity} onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })} />
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <Label>Gender</Label>
                                <GenderSelect value={roomForm.gender} onChange={(g) => setRoomForm({ ...roomForm, gender: g })} />
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Beds 1–{roomForm.capacity || "N"} will be created automatically to match capacity.
                              </p>
                            </div>
                            <DialogFooter>
                              <Button
                                onClick={() => submitRoom({ dormitory_id: dorm.id })}
                                disabled={pending || !roomForm.room_number || !roomForm.capacity}
                              >
                                {pending ? "Creating…" : "Create room"}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      )}

                      {dorm.rooms.length === 0 && <p className="text-sm text-muted-foreground">No rooms yet.</p>}

                      {dorm.rooms.map((room) => (
                        <RoomCard key={room.id} room={room} canWrite={canWrite} onToggleBed={toggleBed} />
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {canWrite && (
                <Dialog open={roomOpen === `house:${house.id}`} onOpenChange={(o) => setRoomOpen(o ? `house:${house.id}` : null)}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="self-start">
                      Add room directly to {house.name}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>New room in {house.name} (no dormitory)</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Room number</Label>
                          <Input value={roomForm.room_number} onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Capacity (beds)</Label>
                          <Input type="number" min={1} value={roomForm.capacity} onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Gender</Label>
                        <GenderSelect value={roomForm.gender} onChange={(g) => setRoomForm({ ...roomForm, gender: g })} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        For schools that don&apos;t group rooms into dormitories -- this room attaches straight to {house.name}.
                      </p>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => submitRoom({ house_id: house.id })}
                        disabled={pending || !roomForm.room_number || !roomForm.capacity}
                      >
                        {pending ? "Creating…" : "Create room"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              {house.direct_rooms.length > 0 && (
                <div className="rounded-md border border-border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Rooms directly in {house.name} (no dormitory)</p>
                  <div className="flex flex-col gap-3">
                    {house.direct_rooms.map((room) => (
                      <RoomCard key={room.id} room={room} canWrite={canWrite} onToggleBed={toggleBed} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Standalone dormitories: schools that use "Dormitory" naming with no House concept at all. */}
      {canWrite && (
        <Dialog open={dormOpen === "standalone"} onOpenChange={(o) => setDormOpen(o ? "standalone" : null)}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="self-start">
              Add dormitory (no house)
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New standalone dormitory</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={dormForm.name} onChange={(e) => setDormForm({ ...dormForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Gender</Label>
                  <GenderSelect value={dormForm.gender} onChange={(g) => setDormForm({ ...dormForm, gender: g })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Capacity (optional)</Label>
                  <Input type="number" min={0} value={dormForm.capacity} onChange={(e) => setDormForm({ ...dormForm, capacity: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                For schools that don&apos;t use a House structure -- this dormitory won&apos;t belong to any house.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => submitDorm(undefined)} disabled={pending || !dormForm.name}>
                {pending ? "Creating…" : "Create dormitory"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {standaloneDormitories.map((dorm) => (
        <div key={dorm.id} className="panel p-4">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setExpandedDorm(expandedDorm === dorm.id ? null : dorm.id)}
          >
            <div>
              <p className="font-medium">{dorm.name}</p>
              <p className="text-xs text-muted-foreground">
                {dorm.gender} · Master: {dorm.master_name ?? "Unassigned"}
              </p>
            </div>
            <span className="text-muted-foreground">{expandedDorm === dorm.id ? "▾" : "▸"}</span>
          </button>

          {expandedDorm === dorm.id && (
            <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
              {canWrite && (
                <Dialog open={roomOpen === dorm.id} onOpenChange={(o) => setRoomOpen(o ? dorm.id : null)}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="self-start">
                      Add room
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>New room in {dorm.name}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Room number</Label>
                          <Input value={roomForm.room_number} onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Capacity (beds)</Label>
                          <Input type="number" min={1} value={roomForm.capacity} onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Gender</Label>
                        <GenderSelect value={roomForm.gender} onChange={(g) => setRoomForm({ ...roomForm, gender: g })} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => submitRoom({ dormitory_id: dorm.id })}
                        disabled={pending || !roomForm.room_number || !roomForm.capacity}
                      >
                        {pending ? "Creating…" : "Create room"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              {dorm.rooms.length === 0 && <p className="text-sm text-muted-foreground">No rooms yet.</p>}
              {dorm.rooms.map((room) => (
                <RoomCard key={room.id} room={room} canWrite={canWrite} onToggleBed={toggleBed} />
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Standalone rooms: schools tracking plain rooms/beds with no House or Dormitory concept. */}
      {canWrite && (
        <Dialog open={roomOpen === "standalone"} onOpenChange={(o) => setRoomOpen(o ? "standalone" : null)}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="self-start">
              Add room (no house or dormitory)
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New standalone room</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Room number</Label>
                  <Input value={roomForm.room_number} onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Capacity (beds)</Label>
                  <Input type="number" min={1} value={roomForm.capacity} onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Gender</Label>
                <GenderSelect value={roomForm.gender} onChange={(g) => setRoomForm({ ...roomForm, gender: g })} />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => submitRoom({})}
                disabled={pending || !roomForm.room_number || !roomForm.capacity}
              >
                {pending ? "Creating…" : "Create room"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {standaloneRooms.length > 0 && (
        <div className="panel p-4">
          <p className="mb-3 text-sm font-medium">Standalone rooms</p>
          <div className="flex flex-col gap-3">
            {standaloneRooms.map((room) => (
              <RoomCard key={room.id} room={room} canWrite={canWrite} onToggleBed={toggleBed} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
