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
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
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
}

export interface StreamOption {
  id: string;
  label: string; // "Grade 6 A"
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

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Nothing in the admissions pipeline right now.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-danger">{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Applicant</TableHead>
            <TableHead>Admission #</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">
                <Link href={`/students/${r.id}`} className="hover:underline">
                  {r.full_name}
                </Link>
              </TableCell>
              <TableCell>{r.admission_number}</TableCell>
              <TableCell className="capitalize">{r.status}</TableCell>
              <TableCell>
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
