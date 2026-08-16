"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { assignSubjectTeacher } from "@/app/(app)/academics/actions";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { ClassRow, StreamRow, TeacherOption } from "./classes-streams-section";
import type { SubjectRow } from "./subjects-section";

export interface ClassSubjectRow {
  stream_id: string;
  subject_id: string;
  teacher_id: string | null;
}

export function TeacherAllocationSection({
  classes,
  streams,
  subjects,
  teachers,
  allocations,
  canWrite,
}: {
  classes: ClassRow[];
  streams: StreamRow[];
  subjects: SubjectRow[];
  teachers: TeacherOption[];
  allocations: ClassSubjectRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allocationMap = new Map(allocations.map((a) => [`${a.stream_id}:${a.subject_id}`, a.teacher_id]));
  // Only offer subjects the school currently has active -- but keep showing a row for a
  // since-deactivated subject if it still has an allocation on record, so existing
  // assignments stay visible rather than silently disappearing from the matrix.
  const allocatedSubjectIds = new Set(allocations.map((a) => a.subject_id));
  const visibleSubjects = subjects.filter((s) => s.is_active || allocatedSubjectIds.has(s.id));

  async function assign(streamId: string, subjectId: string, teacherId: string) {
    const key = `${streamId}:${subjectId}`;
    setPendingKey(key);
    setError(null);
    const result = await assignSubjectTeacher(streamId, subjectId, teacherId === "none" ? null : teacherId);
    setPendingKey(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  if (streams.length === 0 || visibleSubjects.length === 0) {
    return (
      <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">
        Add streams and activate subjects first, then assign a teacher for each subject per stream here.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      {classes
        .slice()
        .sort((a, b) => a.level_order - b.level_order)
        .map((c) => {
          const classStreams = streams.filter((s) => s.class_id === c.id);
          if (classStreams.length === 0) return null;
          return (
            <div key={c.id} className="panel p-4">
              <p className="mb-3 text-sm font-medium">{c.name}</p>
              <div className="overflow-x-auto">
                <table className="table-dense w-full">
                  <thead>
                    <tr>
                      <th className="text-left">Subject</th>
                      {classStreams.map((s) => (
                        <th key={s.id} className="text-left">
                          {c.name} {s.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSubjects.map((subj) => (
                      <tr key={subj.id}>
                        <td>{subj.name}</td>
                        {classStreams.map((s) => {
                          const key = `${s.id}:${subj.id}`;
                          const currentTeacher = allocationMap.get(key) ?? "none";
                          return (
                            <td key={s.id}>
                              {canWrite ? (
                                <Select
                                  value={currentTeacher ?? "none"}
                                  onValueChange={(v) => assign(s.id, subj.id, v)}
                                  disabled={pendingKey === key}
                                >
                                  <SelectTrigger className="h-8 w-40">
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
                                  {teachers.find((t) => t.id === currentTeacher)?.full_name ?? "Unassigned"}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
    </div>
  );
}
