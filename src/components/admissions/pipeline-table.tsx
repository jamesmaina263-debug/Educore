"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import {
  approveApplication,
  enrollApplication,
  activateEnrollment,
  rejectApplication,
} from "@/app/admissions/actions";

export interface ApplicantRow {
  id: string;
  full_name: string;
  admission_number: string;
  status: "applied" | "approved" | "enrolled";
  application_notes: string | null;
}

export interface StreamOption {
  id: string;
  label: string; // "Grade 6 A"
}

function stageTone(status: ApplicantRow["status"]) {
  return status === "enrolled" ? "success" : status === "approved" ? "info" : "warning";
}

export function PipelineTable({
  rows,
  streams,
  canReview,
}: {
  rows: ApplicantRow[];
  streams: StreamOption[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [streamChoice, setStreamChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<{ error: string } | { success: true }>) {
    setPendingId(id);
    setError(null);
    const result = await fn();
    setPendingId(null);
    if ("error" in result) setError(result.error);
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Admissions pipeline</h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            {rows.length} applicant{rows.length === 1 ? "" : "s"}
          </span>
        </header>
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Nothing in the admissions pipeline right now.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Applicant</th>
                  <th>Admission #</th>
                  <th>Stage</th>
                  <th className="text-right"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">
                      <Link href={`/students/${r.id}`} className="hover:underline">
                        {r.full_name}
                      </Link>
                      {r.application_notes && (
                        <p className="mt-0.5 text-[0.6875rem] font-normal text-muted-foreground">{r.application_notes}</p>
                      )}
                    </td>
                    <td className="text-muted-foreground">{r.admission_number}</td>
                    <td>
                      <StatusBadge tone={stageTone(r.status)} label={r.status} />
                    </td>
                    <td className="text-right">
                      {!canReview ? null : r.status === "applied" ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pendingId === r.id}
                            onClick={() => run(r.id, () => rejectApplication(r.id))}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            disabled={pendingId === r.id}
                            onClick={() => run(r.id, () => approveApplication(r.id))}
                          >
                            Approve
                          </Button>
                        </div>
                      ) : r.status === "approved" ? (
                        <div className="flex justify-end gap-2">
                          <Select
                            value={streamChoice[r.id] ?? ""}
                            onValueChange={(v) => setStreamChoice((s) => ({ ...s, [r.id]: v }))}
                          >
                            <SelectTrigger className="h-8 w-40">
                              <SelectValue placeholder="Choose class" />
                            </SelectTrigger>
                            <SelectContent>
                              {streams.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            disabled={pendingId === r.id || !streamChoice[r.id]}
                            onClick={() => run(r.id, () => enrollApplication(r.id, streamChoice[r.id]))}
                          >
                            Enroll
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            disabled={pendingId === r.id}
                            onClick={() => run(r.id, () => activateEnrollment(r.id))}
                          >
                            Activate
                          </Button>
                        </div>
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
