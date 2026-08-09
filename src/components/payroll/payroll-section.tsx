"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { generatePayrollAction, approvePayrollAction, markPayrollPaidAction } from "@/app/payroll/actions";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface PayrollRow {
  id: string;
  teacher_id: string;
  staff_name: string;
  period_year: number;
  period_month: number;
  gross_salary: number;
  nssf_employee: number;
  shif: number;
  ahl: number;
  taxable_income: number;
  paye: number;
  other_deductions: number;
  net_pay: number;
  status: "draft" | "approved" | "paid";
}

export interface StaffOption {
  id: string;
  full_name: string;
}

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = [currentYear - 1, currentYear, currentYear + 1];

export function PayrollSection({
  records,
  staffOptions,
  canGenerate,
  canApprove,
  canMarkPaid,
}: {
  records: PayrollRow[];
  staffOptions: StaffOption[];
  canGenerate: boolean;
  canApprove: boolean;
  canMarkPaid: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [teacherId, setTeacherId] = useState("");
  const [periodYear, setPeriodYear] = useState(String(currentYear));
  const [periodMonth, setPeriodMonth] = useState(String(new Date().getMonth() + 1));
  const [grossSalary, setGrossSalary] = useState("");
  const [otherDeductions, setOtherDeductions] = useState("");
  const [otherDeductionsNote, setOtherDeductionsNote] = useState("");

  async function handleGenerate() {
    setPending(true);
    setError(null);
    const result = await generatePayrollAction({
      teacher_id: teacherId,
      period_year: Number(periodYear),
      period_month: Number(periodMonth),
      gross_salary: Number(grossSalary),
      other_deductions: otherDeductions ? Number(otherDeductions) : 0,
      other_deductions_note: otherDeductionsNote || undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setTeacherId("");
    setGrossSalary("");
    setOtherDeductions("");
    setOtherDeductionsNote("");
    router.refresh();
  }

  async function handleApprove(id: string) {
    setPending(true);
    const result = await approvePayrollAction(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleMarkPaid(id: string) {
    setPending(true);
    const result = await markPayrollPaidAction(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      {canGenerate && (
        <div className="flex justify-end">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Generate payslip
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Generate a payslip</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Staff member</Label>
                  <Select value={teacherId} onValueChange={setTeacherId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select staff member" />
                    </SelectTrigger>
                    <SelectContent>
                      {staffOptions.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Year</Label>
                    <Select value={periodYear} onValueChange={setPeriodYear}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {YEAR_OPTIONS.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Month</Label>
                    <Select value={periodMonth} onValueChange={setPeriodMonth}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => (
                          <SelectItem key={m} value={String(i + 1)}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Gross salary (KES)</Label>
                  <Input type="number" value={grossSalary} onChange={(e) => setGrossSalary(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Other deductions (optional)</Label>
                    <Input type="number" value={otherDeductions} onChange={(e) => setOtherDeductions(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Reason</Label>
                    <Input value={otherDeductionsNote} onChange={(e) => setOtherDeductionsNote(e.target.value)} placeholder="Loan repayment" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  NSSF, SHIF, Housing Levy and PAYE are computed automatically against the statutory rate in effect for the selected month.
                </p>
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
              <DialogFooter>
                <Button onClick={handleGenerate} disabled={pending || !teacherId || !grossSalary}>
                  {pending ? "Generating…" : "Generate"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {records.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No payslips yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Gross</TableHead>
              <TableHead>Net pay</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((r) => (
              <Fragment key={r.id}>
                <TableRow>
                  <TableCell className="font-medium">{r.staff_name}</TableCell>
                  <TableCell>
                    {MONTHS[r.period_month - 1]} {r.period_year}
                  </TableCell>
                  <TableCell>{r.gross_salary.toLocaleString()}</TableCell>
                  <TableCell>{r.net_pay.toLocaleString()}</TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={r.status === "paid" ? "success" : r.status === "approved" ? "info" : "neutral"}
                      label={r.status}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                        {expandedId === r.id ? "Hide" : "Breakdown"}
                      </Button>
                      {canApprove && r.status === "draft" && (
                        <Button size="sm" disabled={pending} onClick={() => handleApprove(r.id)}>
                          Approve
                        </Button>
                      )}
                      {canMarkPaid && r.status === "approved" && (
                        <Button size="sm" disabled={pending} onClick={() => handleMarkPaid(r.id)}>
                          Mark paid
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {expandedId === r.id && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/40">
                      <div className="grid grid-cols-3 gap-x-6 gap-y-1 py-2 text-sm sm:grid-cols-6">
                        <div>
                          <p className="text-xs text-muted-foreground">NSSF</p>
                          <p>{r.nssf_employee.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">SHIF</p>
                          <p>{r.shif.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Housing Levy</p>
                          <p>{r.ahl.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Taxable income</p>
                          <p>{r.taxable_income.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">PAYE</p>
                          <p>{r.paye.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Other deductions</p>
                          <p>{r.other_deductions.toLocaleString()}</p>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
