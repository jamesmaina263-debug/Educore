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
import { createClassLevel, createStream, updateStreamClassTeacher } from "@/app/academics/actions";

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
  teachers,
  canWrite,
}: {
  activeYearId: string | null;
  activeYearName: string | null;
  classes: ClassRow[];
  streams: StreamRow[];
  teachers: TeacherOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [classDialogOpen, setClassDialogOpen] = useState(false);
  const [streamDialogOpen, setStreamDialogOpen] = useState<string | null>(null); // class_id
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [classForm, setClassForm] = useState({ name: "", level_order: 1 });
  const [streamForm, setStreamForm] = useState({ name: "", class_teacher_id: "" });

  if (!activeYearId) {
    return (
      <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Set an active academic year first, on the Years &amp; Terms tab.
      </p>
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
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setStreamDialogOpen(null);
    setStreamForm({ name: "", class_teacher_id: "" });
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
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No classes yet for this academic year.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {classes
            .slice()
            .sort((a, b) => a.level_order - b.level_order)
            .map((c) => {
              const classStreams = streams.filter((s) => s.class_id === c.id);
              return (
                <div key={c.id} className="rounded-md border border-border p-4">
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
                      {classStreams.map((s) => (
                        <li key={s.id} className="flex items-center justify-between text-sm">
                          <span>
                            {c.name} {s.name}
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
                      ))}
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
