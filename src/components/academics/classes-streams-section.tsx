"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createClassLevel, createStream, updateStreamClassTeacher, updateStreamCapacity } from "@/app/(app)/academics/actions";

export interface ClassRow {
  id: string;
  academic_year_id: string;
  name: string;
  level_order: number;
}

export interface StreamRow {
  id: string;
  class_id: string;
  name: string;
  class_teacher_id: string | null;
  capacity: number | null;
}

export interface TeacherOption {
  id: string;
  full_name: string;
}

export function ClassesStreamsSection({
  activeYearId,
  activeYearName,
  classes,
  streams,
  occupancyByStream,
  teachers,
  canWrite,
}: {
  activeYearId: string | null;
  activeYearName: string | null;
  classes: ClassRow[];
  streams: StreamRow[];
  /** Live count of active students currently in each stream, keyed by stream id — computed on read, never stored. */
  occupancyByStream: Record<string, number>;
  teachers: TeacherOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [classDialogOpen, setClassDialogOpen] = useState(false);
  const [streamDialogOpen, setStreamDialogOpen] = useState<string | null>(null); // class_id
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editingCapacityFor, setEditingCapacityFor] = useState<string | null>(null);
  const [capacityDraft, setCapacityDraft] = useState("");

  const [classForm, setClassForm] = useState({ name: "", level_order: 1 });
  const [streamForm, setStreamForm] = useState({ name: "", class_teacher_id: "", capacity: "" });

  if (!activeYearId) {
    return (
      <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">
        Set an active academic year first, on the Years &amp; Terms tab.
      </div>
    );
  }

  async function handleCreateClass() {
    setPending(true);
    setError(null);
    const result = await createClassLevel({ academic_year_id: activeYearId!, ...classForm });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setClassDialogOpen(false);
    setClassForm({ name: "", level_order: 1 });
    router.refresh();
  }

  async function handleCreateStream(classId: string) {
    setPending(true);
    setError(null);
    const result = await createStream({
      class_id: classId,
      name: streamForm.name,
      class_teacher_id: streamForm.class_teacher_id || undefined,
      capacity: streamForm.capacity ? Number(streamForm.capacity) : undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setStreamDialogOpen(null);
    setStreamForm({ name: "", class_teacher_id: "", capacity: "" });
    router.refresh();
  }

  async function handleUpdateCapacity(streamId: string) {
    setPending(true);
    setError(null);
    const parsed = capacityDraft.trim() === "" ? null : Number(capacityDraft);
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) {
      setPending(false);
      setError("Capacity must be a positive number, or blank for unlimited.");
      return;
    }
    const result = await updateStreamCapacity(streamId, parsed);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setEditingCapacityFor(null);
    router.refresh();
  }

  async function handleReassignTeacher(streamId: string, teacherId: string) {
    setPending(true);
    const result = await updateStreamClassTeacher(streamId, teacherId === "none" ? null : teacherId);
    setPending(false);
    if ("error" in result) setError(result.error);
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Academic year: {activeYearName}</p>
        {canWrite && (
          <Dialog open={classDialogOpen} onOpenChange={setClassDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Add class
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New class</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    placeholder="Grade 6"
                    value={classForm.name}
                    onChange={(e) => setClassForm({ ...classForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Level order (for sorting)</Label>
                  <Input
                    type="number"
                    value={classForm.level_order}
                    onChange={(e) => setClassForm({ ...classForm, level_order: Number(e.target.value) })}
                  />
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
              <DialogFooter>
                <Button onClick={handleCreateClass} disabled={pending}>
                  {pending ? "Creating…" : "Create class"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {classes.length === 0 ? (
        <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">
          No classes yet for this academic year.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {classes
            .slice()
            .sort((a, b) => a.level_order - b.level_order)
            .map((c) => {
              const classStreams = streams.filter((s) => s.class_id === c.id);
              return (
                <div key={c.id} className="panel p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium">{c.name}</p>
                    {canWrite && (
                      <Dialog
                        open={streamDialogOpen === c.id}
                        onOpenChange={(open) => setStreamDialogOpen(open ? c.id : null)}
                      >
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline">
                            Add stream
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>New stream — {c.name}</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-3">
                            <div className="space-y-1.5">
                              <Label>Name</Label>
                              <Input
                                placeholder="A"
                                value={streamForm.name}
                                onChange={(e) => setStreamForm({ ...streamForm, name: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Class teacher (optional)</Label>
                              <Select
                                value={streamForm.class_teacher_id}
                                onValueChange={(v) => setStreamForm({ ...streamForm, class_teacher_id: v })}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Unassigned" />
                                </SelectTrigger>
                                <SelectContent>
                                  {teachers.map((t) => (
                                    <SelectItem key={t.id} value={t.id}>
                                      {t.full_name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label>Capacity (optional — leave blank for unlimited)</Label>
                              <Input
                                type="number"
                                min={0}
                                placeholder="e.g. 45"
                                value={streamForm.capacity}
                                onChange={(e) => setStreamForm({ ...streamForm, capacity: e.target.value })}
                              />
                            </div>
                            {error && <p className="text-sm text-danger">{error}</p>}
                          </div>
                          <DialogFooter>
                            <Button onClick={() => handleCreateStream(c.id)} disabled={pending}>
                              {pending ? "Creating…" : "Create stream"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>

                  {classStreams.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No streams yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {classStreams.map((s) => {
                        const occupied = occupancyByStream[s.id] ?? 0;
                        const atOrOverCapacity = s.capacity !== null && occupied >= s.capacity;
                        return (
                          <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="flex items-center gap-2">
                              {c.name} {s.name}
                              {editingCapacityFor === s.id ? (
                                <span className="flex items-center gap-1">
                                  <Input
                                    autoFocus
                                    type="number"
                                    min={0}
                                    className="h-7 w-20"
                                    value={capacityDraft}
                                    onChange={(e) => setCapacityDraft(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleUpdateCapacity(s.id)}
                                  />
                                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleUpdateCapacity(s.id)} disabled={pending}>
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2"
                                    onClick={() => setEditingCapacityFor(null)}
                                    disabled={pending}
                                  >
                                    Cancel
                                  </Button>
                                </span>
                              ) : (
                                <span
                                  className={atOrOverCapacity ? "font-medium text-danger" : "text-muted-foreground"}
                                  title={canWrite ? "Click to edit capacity" : undefined}
                                  onClick={() => {
                                    if (!canWrite) return;
                                    setEditingCapacityFor(s.id);
                                    setCapacityDraft(s.capacity?.toString() ?? "");
                                  }}
                                  role={canWrite ? "button" : undefined}
                                  style={canWrite ? { cursor: "pointer" } : undefined}
                                >
                                  — {occupied}{s.capacity !== null ? `/${s.capacity}` : " students"}
                                </span>
                              )}
                            </span>
                            {canWrite ? (
                              <Select
                                value={s.class_teacher_id ?? "none"}
                                onValueChange={(v) => handleReassignTeacher(s.id, v)}
                              >
                                <SelectTrigger className="h-8 w-48">
                                  <SelectValue placeholder="Unassigned" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Unassigned</SelectItem>
                                  {teachers.map((t) => (
                                    <SelectItem key={t.id} value={t.id}>
                                      {t.full_name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-muted-foreground">
                                {teachers.find((t) => t.id === s.class_teacher_id)?.full_name ?? "Unassigned"}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
