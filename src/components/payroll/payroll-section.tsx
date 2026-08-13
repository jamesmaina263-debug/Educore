"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { generatePayrollAction, approvePayrollAction, markPayrollPaidAction, saveSalaryStructureAction } from "@/app/payroll/actions";

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

export interface SalaryStructureRow {
  id: string;
  staff_id: string;
  staff_name: string;
  basic_salary: number;
  effective_from: string;
  allowances: { id: string; name: string; amount: number }[];
  deductions: { id: string; name: string; amount: number }[];
}

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = [currentYear - 1, currentYear, currentYear + 1];

async function downloadPayslip(schoolName: string, r: PayrollRow) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  let y = 16;
  doc.setFontSize(14);
  doc.text(schoolName, 14, y);
  y += 6;
  doc.setFontSize(11);
  doc.text(`Payslip — ${MONTHS[r.period_month - 1]} ${r.period_year}`, 14, y);
  y += 8;
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`Employee: ${r.staff_name}`, 14, y);
  y += 10;
  doc.setTextColor(0);

  const rows: [string, string][] = [
    ["Gross Salary", r.gross_salary.toLocaleString()],
    ["NSSF (Employee)", r.nssf_employee.toLocaleString()],
    ["SHIF", r.shif.toLocaleString()],
    ["Affordable Housing Levy", r.ahl.toLocaleString()],
    ["Taxable Income", r.taxable_income.toLocaleString()],
    ["PAYE", r.paye.toLocaleString()],
    ["Other Deductions", r.other_deductions.toLocaleString()],
    ["Net Pay", r.net_pay.toLocaleString()],
  ];
  doc.setFontSize(10);
  for (const [label, value] of rows) {
    doc.text(label, 14, y);
    doc.text(value, 140, y, { align: "right" });
    y += 7;
  }
  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text("Computed against the Kenyan statutory rate in effect for this period.", 14, y + 6);

  doc.save(`payslip-${r.staff_name.replace(/\s+/g, "-").toLowerCase()}-${r.period_year}-${String(r.period_month).padStart(2, "0")}.pdf`);
}

export function PayrollSection({
  records,
  staffOptions,
  structures,
  schoolName,
  canGenerate,
  canApprove,
  canMarkPaid,
  canManageStructures,
}: {
  records: PayrollRow[];
  staffOptions: StaffOption[];
  structures: SalaryStructureRow[];
  schoolName: string;
  canGenerate: boolean;
  canApprove: boolean;
  canMarkPaid: boolean;
  canManageStructures: boolean;
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

  const [structureOpen, setStructureOpen] = useState(false);
  const [structureStaffId, setStructureStaffId] = useState("");
  const [basicSalary, setBasicSalary] = useState("");
  const [allowances, setAllowances] = useState<{ name: string; amount: string }[]>([]);
  const [deductions, setDeductions] = useState<{ name: string; amount: string }[]>([]);

  function applyStructureToGenerateForm(staffId: string) {
    setTeacherId(staffId);
    const structure = structures.find((s) => s.staff_id === staffId);
    if (structure) {
      const allowanceTotal = structure.allowances.reduce((sum, a) => sum + a.amount, 0);
      const deductionTotal = structure.deductions.reduce((sum, d) => sum + d.amount, 0);
      setGrossSalary(String(structure.basic_salary + allowanceTotal));
      if (deductionTotal > 0) {
        setOtherDeductions(String(deductionTotal));
        setOtherDeductionsNote(structure.deductions.map((d) => d.name).join(", "));
      }
    }
  }

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

  function openStructureEditor(existing?: SalaryStructureRow) {
    if (existing) {
      setStructureStaffId(existing.staff_id);
      setBasicSalary(String(existing.basic_salary));
      setAllowances(existing.allowances.map((a) => ({ name: a.name, amount: String(a.amount) })));
      setDeductions(existing.deductions.map((d) => ({ name: d.name, amount: String(d.amount) })));
    } else {
      setStructureStaffId("");
      setBasicSalary("");
      setAllowances([]);
      setDeductions([]);
    }
    setStructureOpen(true);
  }

  async function handleSaveStructure() {
    setPending(true);
    setError(null);
    const result = await saveSalaryStructureAction({
      staff_id: structureStaffId,
      basic_salary: Number(basicSalary),
      allowances: allowances.filter((a) => a.name && a.amount).map((a) => ({ name: a.name, amount: Number(a.amount) })),
      deductions: deductions.filter((d) => d.name && d.amount).map((d) => ({ name: d.name, amount: Number(d.amount) })),
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setStructureOpen(false);
    router.refresh();
  }

  const now = new Date();
  const thisMonthRecords = records.filter((r) => r.period_year === now.getFullYear() && r.period_month === now.getMonth() + 1);
  const pendingApprovals = records.filter((r) => r.status === "draft").length;
  const totalNetThisMonth = thisMonthRecords.reduce((sum, r) => sum + r.net_pay, 0);

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Staff with Salary Structure</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight" data-numeric>{structures.length}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Payslips This Month</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight" data-numeric>{thisMonthRecords.length}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Pending Approval</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight" data-numeric>{pendingApprovals}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Net Pay This Month</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight" data-numeric>{totalNetThisMonth.toLocaleString()}</p>
        </div>
      </div>

      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">Payroll Runs</TabsTrigger>
          {(canManageStructures || structures.length > 0) && <TabsTrigger value="structures">Salary Structures</TabsTrigger>}
        </TabsList>

        <TabsContent value="runs">
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
                        <Select value={teacherId} onValueChange={applyStructureToGenerateForm}>
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
                        {structures.some((s) => s.staff_id === teacherId) && (
                          <p className="text-[0.6875rem] text-muted-foreground">Prefilled from their salary structure — adjust if needed.</p>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button size="sm" variant="ghost" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                                {expandedId === r.id ? "Hide" : "Breakdown"}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => downloadPayslip(schoolName, r)}>
                                Payslip
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
        </TabsContent>

        <TabsContent value="structures">
          <div className="panel">
            <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div className="flex items-center gap-3">
                <h2 className="text-[0.8125rem] font-semibold">Salary Structures</h2>
                <span className="text-[0.6875rem] text-muted-foreground">
                  {structures.length} staff member{structures.length === 1 ? "" : "s"}
                </span>
              </div>
              {canManageStructures && (
                <Dialog open={structureOpen} onOpenChange={setStructureOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" onClick={() => openStructureEditor()}>
                      Set Salary Structure
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Salary Structure</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label>Staff member</Label>
                        <Select value={structureStaffId} onValueChange={setStructureStaffId}>
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
                      <div className="space-y-1.5">
                        <Label>Basic Salary (KES)</Label>
                        <Input type="number" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label>Allowances</Label>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setAllowances([...allowances, { name: "", amount: "" }])}
                          >
                            + Add
                          </Button>
                        </div>
                        {allowances.map((a, i) => (
                          <div key={i} className="flex gap-2">
                            <Input
                              placeholder="e.g. House Allowance"
                              value={a.name}
                              onChange={(e) => setAllowances(allowances.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                            />
                            <Input
                              type="number"
                              placeholder="Amount"
                              className="w-32"
                              value={a.amount}
                              onChange={(e) => setAllowances(allowances.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                            />
                            <Button type="button" size="sm" variant="ghost" onClick={() => setAllowances(allowances.filter((_, j) => j !== i))}>
                              ✕
                            </Button>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label>Recurring Deductions</Label>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeductions([...deductions, { name: "", amount: "" }])}
                          >
                            + Add
                          </Button>
                        </div>
                        {deductions.map((d, i) => (
                          <div key={i} className="flex gap-2">
                            <Input
                              placeholder="e.g. Staff Loan Repayment"
                              value={d.name}
                              onChange={(e) => setDeductions(deductions.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                            />
                            <Input
                              type="number"
                              placeholder="Amount"
                              className="w-32"
                              value={d.amount}
                              onChange={(e) => setDeductions(deductions.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                            />
                            <Button type="button" size="sm" variant="ghost" onClick={() => setDeductions(deductions.filter((_, j) => j !== i))}>
                              ✕
                            </Button>
                          </div>
                        ))}
                      </div>
                      {error && <p className="text-sm text-danger">{error}</p>}
                    </div>
                    <DialogFooter>
                      <Button onClick={handleSaveStructure} disabled={pending || !structureStaffId || !basicSalary}>
                        {pending ? "Saving…" : "Save"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </header>

            {structures.length === 0 ? (
              <p className="p-10 text-center text-sm text-muted-foreground">No salary structures set yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-dense w-full">
                  <thead className="bg-muted/70">
                    <tr>
                      <th>Staff</th>
                      <th className="text-right">Basic</th>
                      <th>Allowances</th>
                      <th>Deductions</th>
                      <th className="text-right">Gross</th>
                      {canManageStructures && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {structures.map((s) => {
                      const allowanceTotal = s.allowances.reduce((sum, a) => sum + a.amount, 0);
                      return (
                        <tr key={s.id}>
                          <td className="font-medium">{s.staff_name}</td>
                          <td className="text-right" data-numeric>{s.basic_salary.toLocaleString()}</td>
                          <td className="text-muted-foreground">
                            {s.allowances.length === 0 ? "—" : s.allowances.map((a) => `${a.name} (${a.amount.toLocaleString()})`).join(", ")}
                          </td>
                          <td className="text-muted-foreground">
                            {s.deductions.length === 0 ? "—" : s.deductions.map((d) => `${d.name} (${d.amount.toLocaleString()})`).join(", ")}
                          </td>
                          <td className="text-right" data-numeric>{(s.basic_salary + allowanceTotal).toLocaleString()}</td>
                          {canManageStructures && (
                            <td className="text-right">
                              <Button size="sm" variant="ghost" onClick={() => openStructureEditor(s)}>
                                Edit
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
