"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { createPtSlotAction, deletePtSlotAction } from "@/app/pt-meetings/actions";

export interface SlotRow {
  id: string;
  teacher_id: string;
  teacher_name: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  location: string | null;
  capacity: number;
  is_own: boolean;
  booked_count: number;
  booked_students: string[];
}

export function PtMeetingsSection({
  slots,
  schoolUserId,
  canWriteAny,
}: {
  slots: SlotRow[];
  schoolUserId: string | null;
  canWriteAny: boolean;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = canWriteAny ? slots : slots.filter((s) => s.is_own || s.teacher_id === schoolUserId);

  async function handleCreate(formData: FormData) {
    setPending(true);
    setError(null);
    const res = await createPtSlotAction(formData);
    setPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setAddOpen(false);
    router.refresh();
  }

  async function handleDelete(id: string) {
    const res = await deletePtSlotAction(id);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">Publish slot</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Publish a meeting slot</DialogTitle>
            </DialogHeader>
            <form action={handleCreate} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="slot_date">Date</Label>
                <Input id="slot_date" name="slot_date" type="date" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="start_time">Start time</Label>
                  <Input id="start_time" name="start_time" type="time" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end_time">End time</Label>
                  <Input id="end_time" name="end_time" type="time" required />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="location">Location (optional)</Label>
                <Input id="location" name="location" placeholder="e.g. Staff room" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="capacity">Capacity</Label>
                <Input id="capacity" name="capacity" type="number" min={1} defaultValue={1} />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? "Publishing…" : "Publish"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Teacher</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Booked</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.teacher_name}</TableCell>
              <TableCell>{s.slot_date}</TableCell>
              <TableCell>
                {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
              </TableCell>
              <TableCell>{s.location ?? "—"}</TableCell>
              <TableCell>
                <StatusBadge
                  tone={s.booked_count >= s.capacity ? "warning" : "neutral"}
                  label={`${s.booked_count}/${s.capacity}`}
                />
                {s.booked_students.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">{s.booked_students.join(", ")}</p>
                )}
              </TableCell>
              <TableCell>
                {(s.is_own || canWriteAny) && (
                  <Button size="sm" variant="outline" onClick={() => handleDelete(s.id)}>
                    Remove
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No slots published yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
