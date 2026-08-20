"use client";

import { useState } from "react";
import { requestLeave, respondToLeaveRequest, cancelLeaveRequest } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export interface LeaveTypeOption {
  id: string;
  name: string;
  days_per_year: number;
  restricted_gender: "male" | "female" | null;
}

export interface LeaveRequestRow {
  id: string;
  leave_type_name: string;
  start_date: string;
  end_date: string;
  days_count: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string | null;
}

export function LeaveTab({
  staffId,
  leaveTypes,
  requests,
  balances,
  isSelf,
  canApprove,
  staffGender,
}: {
  staffId: string;
  leaveTypes: LeaveTypeOption[];
  requests: LeaveRequestRow[];
  /** Days remaining this year per leave type, computed live from approved requests — not stored. */
  balances: { leave_type_id: string; name: string; allocated: number; used: number }[];
  isSelf: boolean;
  canApprove: boolean;
  /** Gender must be set (on the Employment tab, by an admin) before any leave can be requested — also gates gender-restricted leave types. */
  staffGender: "male" | "female" | null;
}) {
  // Requestable types: unrestricted, or restricted to this staff member's own gender. Balances
  // above still show every type the staff has ever had a request against, unfiltered.
  const requestableTypes = leaveTypes.filter((t) => !t.restricted_gender || t.restricted_gender === staffGender);

  const [requesting, setRequesting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    leave_type_id: requestableTypes[0]?.id ?? "",
    start_date: "",
    end_date: "",
    reason: "",
  });

  async function submit() {
    if (!form.leave_type_id || !form.start_date || !form.end_date) {
      setError("Leave type, start date, and end date are required.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await requestLeave(staffId, form);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setRequesting(false);
    setForm({ leave_type_id: requestableTypes[0]?.id ?? "", start_date: "", end_date: "", reason: "" });
  }

  async function respond(requestId: string, status: "approved" | "rejected") {
    setPending(true);
    await respondToLeaveRequest(requestId, staffId, status);
    setPending(false);
  }

  async function cancel(requestId: string) {
    setPending(true);
    await cancelLeaveRequest(requestId, staffId);
    setPending(false);
  }

  const statusTone: Record<LeaveRequestRow["status"], "success" | "danger" | "neutral"> = {
    approved: "success",
    rejected: "danger",
    cancelled: "neutral",
    pending: "neutral",
  };

  return (
    <div className="space-y-6">
      {balances.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {balances.map((b) => (
            <div key={b.leave_type_id} className="panel p-3">
              <p className="label-eyebrow">{b.name}</p>
              <p className="mt-1 text-lg font-semibold">
                {Math.max(b.allocated - b.used, 0)}
                <span className="text-sm font-normal text-muted-foreground"> / {b.allocated} days left</span>
              </p>
            </div>
          ))}
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium">Leave requests</h3>
        <ul className="divide-y divide-border rounded-md border border-border">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{r.leave_type_name}</span>{" "}
                <span className="text-muted-foreground">
                  — {r.start_date} to {r.end_date} ({r.days_count} days)
                </span>
                {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={statusTone[r.status]} label={r.status} />
                {canApprove && r.status === "pending" && (
                  <>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => respond(r.id, "approved")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => respond(r.id, "rejected")}>
                      Reject
                    </Button>
                  </>
                )}
                {isSelf && r.status === "pending" && !canApprove && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => cancel(r.id)}>
                    Cancel
                  </Button>
                )}
              </div>
            </li>
          ))}
          {requests.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">No leave requests yet.</li>
          )}
        </ul>
      </div>

      {isSelf && staffGender === null && (
        <p className="text-sm text-muted-foreground">
          Your gender isn&apos;t set yet — ask an admin to set it on your Employment tab before you can request
          leave.
        </p>
      )}

      {isSelf && staffGender !== null && !requesting && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRequesting(true)}
          disabled={requestableTypes.length === 0}
        >
          Request leave
        </Button>
      )}

      {isSelf && staffGender !== null && requesting && (
        <div className="space-y-3 rounded-md border border-border p-4">
          <div className="space-y-1.5">
            <Label>Leave type</Label>
            <Select value={form.leave_type_id} onValueChange={(v) => setForm({ ...form, leave_type_id: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {requestableTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ls">Start date</Label>
              <Input
                id="ls"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="le">End date</Label>
              <Input
                id="le"
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lr">Reason</Label>
            <Input id="lr" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>
              {pending ? "Submitting…" : "Submit request"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRequesting(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
