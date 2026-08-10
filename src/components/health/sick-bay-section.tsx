"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { checkInStudent, checkOutStudent } from "@/app/health/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { StudentOption } from "./student-picker";

export interface SickBayVisitRow {
  id: string;
  student_name: string;
  check_in_at: string;
  reason: string;
  symptoms: string | null;
  temperature_c: number | null;
  check_out_at: string | null;
  outcome: string | null;
  is_open: boolean;
}

type Outcome = "returned_to_class" | "sent_home" | "referred" | "collected_by_guardian";

export function SickBaySection({
  visits,
  studentOptions,
  canWrite,
}: {
  visits: SickBayVisitRow[];
  studentOptions: StudentOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkOutFor, setCheckOutFor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [checkInForm, setCheckInForm] = useState({ student_id: "", reason: "", symptoms: "", temperature_c: "" });
  const [checkOutForm, setCheckOutForm] = useState<{ outcome: Outcome; notes: string }>({ outcome: "returned_to_class", notes: "" });

  async function submitCheckIn() {
    setPending(true);
    setError(null);
    const result = await checkInStudent({
      student_id: checkInForm.student_id,
      reason: checkInForm.reason,
      symptoms: checkInForm.symptoms || undefined,
      temperature_c: checkInForm.temperature_c ? Number(checkInForm.temperature_c) : undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setCheckInOpen(false);
    setCheckInForm({ student_id: "", reason: "", symptoms: "", temperature_c: "" });
    router.refresh();
  }

  async function submitCheckOut(visitId: string) {
    setPending(true);
    setError(null);
    const result = await checkOutStudent(visitId, checkOutForm.outcome, checkOutForm.notes || undefined);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setCheckOutFor(null);
    setCheckOutForm({ outcome: "returned_to_class", notes: "" });
    router.refresh();
  }

  const visible = visits.filter((v) => (showHistory ? true : v.is_open));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        {canWrite && (
          <Dialog open={checkInOpen} onOpenChange={setCheckInOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Check in student</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Check in to sick bay</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Select value={checkInForm.student_id} onValueChange={(v) => setCheckInForm({ ...checkInForm, student_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Student" />
                  </SelectTrigger>
                  <SelectContent>
                    {studentOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input placeholder="Reason" value={checkInForm.reason} onChange={(e) => setCheckInForm({ ...checkInForm, reason: e.target.value })} />
                <Textarea placeholder="Symptoms (optional)" value={checkInForm.symptoms} onChange={(e) => setCheckInForm({ ...checkInForm, symptoms: e.target.value })} />
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Temperature °C (optional)"
                  value={checkInForm.temperature_c}
                  onChange={(e) => setCheckInForm({ ...checkInForm, temperature_c: e.target.value })}
                />
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
              <DialogFooter>
                <Button onClick={submitCheckIn} disabled={pending || !checkInForm.student_id || !checkInForm.reason}>
                  {pending ? "Checking in…" : "Check in"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        <Button size="sm" variant="ghost" onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? "Hide history" : "Show full history"}
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead>
            <tr>
              <th className="text-left">Student</th>
              <th className="text-left">Checked in</th>
              <th className="text-left">Reason</th>
              <th className="text-left">Temp</th>
              <th className="text-left">Status</th>
              {canWrite && <th />}
            </tr>
          </thead>
          <tbody>
            {visible.map((v) => (
              <tr key={v.id}>
                <td>{v.student_name}</td>
                <td>{new Date(v.check_in_at).toLocaleString()}</td>
                <td className="text-muted-foreground">{v.reason}</td>
                <td>{v.temperature_c ? `${v.temperature_c}°C` : "—"}</td>
                <td>
                  <StatusBadge tone={v.is_open ? "danger" : "success"} label={v.is_open ? "In sick bay" : (v.outcome ?? "checked out").replace(/_/g, " ")} />
                </td>
                {canWrite && (
                  <td>
                    {v.is_open &&
                      (checkOutFor === v.id ? (
                        <div className="flex items-center gap-1">
                          <Select value={checkOutForm.outcome} onValueChange={(o: Outcome) => setCheckOutForm({ ...checkOutForm, outcome: o })}>
                            <SelectTrigger className="h-8 w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="returned_to_class">Returned to class</SelectItem>
                              <SelectItem value="sent_home">Sent home</SelectItem>
                              <SelectItem value="referred">Referred</SelectItem>
                              <SelectItem value="collected_by_guardian">Collected by guardian</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button size="sm" onClick={() => submitCheckOut(v.id)} disabled={pending}>
                            Confirm
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setCheckOutFor(v.id)}>
                          Check out
                        </Button>
                      ))}
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  {showHistory ? "No sick bay visits on record." : "No one currently in sick bay."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
