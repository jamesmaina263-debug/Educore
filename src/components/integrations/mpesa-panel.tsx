"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
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
import type { MpesaStudentOption, MpesaRequestRow } from "@/app/(app)/integrations/_data";
import {
  saveMpesaCredentials,
  setMpesaActive,
  initiateMpesaPush,
  getMpesaRequestStatus,
} from "@/app/(app)/integrations/actions";

const STATUS_LABEL: Record<MpesaRequestRow["status"], { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
  pending: { label: "Awaiting response", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export function MpesaSettingsCard({
  canManage,
  shortcode,
  shortcodeType,
  environment,
  isActive,
  hasCredentials,
}: {
  canManage: boolean;
  shortcode: string | null;
  shortcodeType: "paybill" | "till" | null;
  environment: "sandbox" | "production";
  isActive: boolean;
  hasCredentials: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    shortcode: shortcode ?? "",
    shortcodeType: (shortcodeType ?? "paybill") as "paybill" | "till",
    environment: environment,
    consumerKey: "",
    consumerSecret: "",
    passkey: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglePending, setTogglePending] = useState(false);

  async function handleSave() {
    setPending(true);
    setError(null);
    const result = await saveMpesaCredentials(form);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    router.refresh();
  }

  async function handleToggle(next: boolean) {
    setTogglePending(true);
    const result = await setMpesaActive(next);
    setTogglePending(false);
    if ("error" in result) {
      alert(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="label-eyebrow">M-Pesa configuration</p>
          <div className="flex items-center gap-2">
            <p className="text-lg font-semibold">{shortcode ? `${shortcode} (${shortcodeType})` : "Not configured"}</p>
            <StatusBadge tone={isActive ? "success" : "neutral"} label={isActive ? "Active" : "Inactive"} />
          </div>
          <p className="text-xs text-muted-foreground capitalize">{environment}</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-4">
            <Button
              variant={isActive ? "outline" : "default"}
              size="sm"
              disabled={togglePending || (!isActive && !hasCredentials)}
              onClick={() => handleToggle(!isActive)}
            >
              {togglePending ? "Updating…" : isActive ? "Deactivate" : "Activate"}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  {hasCredentials ? "Update credentials" : "Set up M-Pesa"}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>M-Pesa Daraja credentials</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="shortcode">Shortcode</Label>
                      <Input
                        id="shortcode"
                        value={form.shortcode}
                        onChange={(e) => setForm((f) => ({ ...f, shortcode: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Type</Label>
                      <Select
                        value={form.shortcodeType}
                        onValueChange={(v) => setForm((f) => ({ ...f, shortcodeType: v as "paybill" | "till" }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="paybill">Paybill</SelectItem>
                          <SelectItem value="till">Till</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Environment</Label>
                    <Select
                      value={form.environment}
                      onValueChange={(v) => setForm((f) => ({ ...f, environment: v as "sandbox" | "production" }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sandbox">Sandbox</SelectItem>
                        <SelectItem value="production">Production</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="consumer_key">Consumer key</Label>
                    <Input
                      id="consumer_key"
                      value={form.consumerKey}
                      onChange={(e) => setForm((f) => ({ ...f, consumerKey: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="consumer_secret">Consumer secret</Label>
                    <Input
                      id="consumer_secret"
                      type="password"
                      value={form.consumerSecret}
                      onChange={(e) => setForm((f) => ({ ...f, consumerSecret: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="passkey">Passkey</Label>
                    <Input
                      id="passkey"
                      type="password"
                      value={form.passkey}
                      onChange={(e) => setForm((f) => ({ ...f, passkey: e.target.value }))}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Credentials are never displayed again after saving. Activate below once saved.
                  </p>
                  {error && <p className="text-sm text-danger">{error}</p>}
                </div>
                <DialogFooter>
                  <Button onClick={handleSave} disabled={pending}>
                    {pending ? "Saving…" : "Save"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>
      {!hasCredentials && (
        <p className="text-sm text-muted-foreground">
          M-Pesa pushes are disabled until credentials are saved and activated here.
        </p>
      )}
    </div>
  );
}

export function MpesaPushPanel({
  students,
  requests,
  canPush,
  isActive,
}: {
  students: MpesaStudentOption[];
  requests: MpesaRequestRow[];
  canPush: boolean;
  isActive: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const filteredStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students.slice(0, 20);
    return students
      .filter((s) => s.name.toLowerCase().includes(q) || s.admission_number.toLowerCase().includes(q))
      .slice(0, 20);
  }, [students, query]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handlePush() {
    if (!studentId || !amount || !phone) return;
    setPending(true);
    setError(null);
    const result = await initiateMpesaPush({
      studentId,
      amount: Number(amount),
      phoneNumber: phone,
      notes: notes || undefined,
    });
    if ("error" in result) {
      setPending(false);
      return setError(result.error);
    }

    // Poll for resolution for up to ~60s, then stop -- the batch history table below will
    // reflect the final status regardless once the page is refreshed.
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      const status = await getMpesaRequestStatus(result.requestId);
      if ("success" in status && status.status !== "pending") {
        if (pollRef.current) clearInterval(pollRef.current);
        setPending(false);
        setOpen(false);
        setStudentId("");
        setAmount("");
        setPhone("");
        setNotes("");
        router.refresh();
      } else if (attempts >= 20) {
        if (pollRef.current) clearInterval(pollRef.current);
        setPending(false);
        router.refresh();
      }
    }, 3000);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="panel flex items-center justify-between p-4">
        <div>
          <p className="label-eyebrow">Push a payment prompt</p>
          <p className="text-sm text-muted-foreground">
            Sends an STK prompt directly to a parent&apos;s phone for them to approve.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={!canPush || !isActive}>Push STK prompt</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Push M-Pesa prompt</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="student_search">Student</Label>
                <Input
                  id="student_search"
                  placeholder="Search by name or admission number"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <Select value={studentId} onValueChange={setStudentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a student" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredStudents.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} — {s.admission_number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="push_amount">Amount (KES)</Label>
                  <Input id="push_amount" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="push_phone">Phone number</Label>
                  <Input
                    id="push_phone"
                    placeholder="07XX XXX XXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="push_notes">Notes (optional)</Label>
                <Input id="push_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={handlePush} disabled={pending || !studentId || !amount || !phone}>
                {pending ? "Waiting for response…" : "Send prompt"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="panel flex flex-col gap-3 p-4">
        <p className="label-eyebrow">Recent pushes</p>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No M-Pesa pushes yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => {
                const status = STATUS_LABEL[r.status];
                return (
                  <TableRow key={r.id}>
                    <TableCell>{r.student_name}</TableCell>
                    <TableCell>KES {r.amount.toLocaleString()}</TableCell>
                    <TableCell>{r.phone_number}</TableCell>
                    <TableCell>
                      <StatusBadge tone={status.tone} label={status.label} />
                      {r.status === "failed" && r.result_desc && (
                        <p className="mt-1 text-xs text-muted-foreground">{r.result_desc}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(r.initiated_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
