"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-3">
            <h2 className="text-[0.8125rem] font-semibold">Payslips</h2>
            <span className="text-[0.6875rem] text-muted-foreground">
              {records.length} payslip{records.length === 1 ? "" : "s"}
            </span>
          </div>
          {canGenerate && (
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
                  <p className="text-[0.75rem] text-muted-foreground">
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
          )}
        </header>

        {records.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No payslips yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Staff</th>
                  <th>Period</th>
                  <th className="text-right">Gross</th>
                  <th className="text-right">Net pay</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td className="font-medium">{r.staff_name}</td>
                      <td className="text-muted-foreground">
                        {MONTHS[r.period_month - 1]} {r.period_year}
                      </td>
                      <td className="text-right" data-numeric>
                        {r.gross_salary.toLocaleString()}
                      </td>
                      <td className="text-right" data-numeric>
                        {r.net_pay.toLocaleString()}
                      </td>
                      <td>
                        <StatusBadge
                          tone={r.status === "paid" ? "success" : r.status === "approved" ? "info" : "neutral"}
                          label={r.status}
                        />
                      </td>
                      <td className="text-right">
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
                      </td>
                    </tr>
                    {expandedId === r.id && (
                      <tr>
                        <td colSpan={6} className="bg-muted/30">
                          <div className="grid grid-cols-3 gap-x-6 gap-y-2 p-3 text-[0.8125rem] sm:grid-cols-6">
                            <div>
                              <p className="text-[0.6875rem] text-muted-foreground">NSSF</p>
                              <p data-numeric>{r.nssf_employee.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-[0.6875rem] text-muted-foreground">SHIF</p>
                              <p data-numeric>{r.shif.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-[0.6875rem] text-muted-foreground">Housing Levy</p>
                              <p data-numeric>{r.ahl.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-[0.6875rem] text-muted-foreground">Taxable income</p>
                              <p data-numeric>{r.taxable_income.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-[0.6875rem] text-muted-foreground">PAYE</p>
                              <p data-numeric>{r.paye.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-[0.6875rem] text-muted-foreground">Other deductions</p>
                              <p data-numeric>{r.other_deductions.toLocaleString()}</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
