"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { generatePayrollAction, approvePayrollAction, markPayrollPaidAction, saveSalaryStructureAction, updateStaffStatutoryNumbersAction } from "@/app/(app)/payroll/actions";
import { TableExportMenu } from "@/components/shared/table-export-menu";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface PayrollRow {
  id: string;
  teacher_id: string;
  staff_name: string;
  staff_number: string | null;
  staff_kra_pin: string | null;
  staff_nssf_number: string | null;
  staff_shif_number: string | null;
  period_year: number;
  period_month: number;
  gross_salary: number;
  nssf_employee: number;
  shif: number;
  ahl: number;
  taxable_income: number;
  paye: number;
  other_deductions: number;
  allowances_breakdown: { name: string; amount: number }[];
  deductions_breakdown: { name: string; amount: number }[];
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
  staff_number: string | null;
  staff_kra_pin: string | null;
  staff_nssf_number: string | null;
  staff_shif_number: string | null;
  basic_salary: number;
  effective_from: string;
  allowances: { id: string; name: string; amount: number }[];
  deductions: { id: string; name: string; amount: number }[];
}

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = [currentYear - 1, currentYear, currentYear + 1];

async function downloadPayslip(schoolName: string, employerKraPin: string | null, r: PayrollRow) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF();
  let y = 16;

  doc.setFontSize(14);
  doc.text(schoolName, 14, y);
  y += 6;
  if (employerKraPin) {
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(`Employer KRA PIN: ${employerKraPin}`, 14, y);
    doc.setTextColor(0);
    y += 6;
  }
  doc.setFontSize(11);
  doc.text(`Payslip — ${MONTHS[r.period_month - 1]} ${r.period_year}`, 14, y);
  y += 8;

  // Employee identity block — every field the brief calls "standard" that we actually have
  // data for. Fields the person never set (staff number, their own KRA PIN, NSSF/SHIF
  // numbers) are simply omitted rather than printed as blank/placeholder lines.
  doc.setFontSize(9);
  const identityLines: string[] = [`Employee: ${r.staff_name}`];
  if (r.staff_number) identityLines.push(`Staff No: ${r.staff_number}`);
  if (r.staff_kra_pin) identityLines.push(`KRA PIN: ${r.staff_kra_pin}`);
  if (r.staff_nssf_number) identityLines.push(`NSSF No: ${r.staff_nssf_number}`);
  if (r.staff_shif_number) identityLines.push(`SHIF No: ${r.staff_shif_number}`);
  doc.setTextColor(60);
  for (const line of identityLines) {
    doc.text(line, 14, y);
    y += 5;
  }
  doc.setTextColor(0);
  y += 3;

  const basicSalary = r.gross_salary - r.allowances_breakdown.reduce((sum, a) => sum + a.amount, 0);

  const earningsRows: [string, string][] = [["Basic Salary", basicSalary.toLocaleString()]];
  for (const a of r.allowances_breakdown) {
    earningsRows.push([a.name, a.amount.toLocaleString()]);
  }
  earningsRows.push(["Gross Pay", r.gross_salary.toLocaleString()]);

  autoTable(doc, {
    startY: y,
    head: [["Earnings", "Amount (KES)"]],
    body: earningsRows,
    theme: "grid",
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: { 1: { halign: "right" } },
    didParseCell: (data) => {
      if (data.section === "body" && (data.row.raw as string[])[0] === "Gross Pay") {
        data.cell.styles.fontStyle = "bold";
      }
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(`Taxable Pay: KES ${r.taxable_income.toLocaleString()}`, 14, y);
  doc.setTextColor(0);
  y += 6;

  const deductionRows: [string, string][] = [
    ["NSSF (Employee)", r.nssf_employee.toLocaleString()],
    ["SHIF", r.shif.toLocaleString()],
    ["Affordable Housing Levy", r.ahl.toLocaleString()],
    ["PAYE", r.paye.toLocaleString()],
  ];
  for (const d of r.deductions_breakdown) {
    deductionRows.push([d.name, d.amount.toLocaleString()]);
  }
  const totalDeductions = r.nssf_employee + r.shif + r.ahl + r.paye + r.other_deductions;
  deductionRows.push(["Total Deductions", totalDeductions.toLocaleString()]);

  autoTable(doc, {
    startY: y,
    head: [["Deductions", "Amount (KES)"]],
    body: deductionRows,
    theme: "grid",
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: { 1: { halign: "right" } },
    didParseCell: (data) => {
      if (data.section === "body" && (data.row.raw as string[])[0] === "Total Deductions") {
        data.cell.styles.fontStyle = "bold";
      }
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(`Net Pay: KES ${r.net_pay.toLocaleString()}`, 14, y);
  doc.setFont("helvetica", "normal");
  y += 8;

  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text("Computed against the Kenyan statutory rate in effect for this period.", 14, y);

  doc.save(`payslip-${r.staff_name.replace(/\s+/g, "-").toLowerCase()}-${r.period_year}-${String(r.period_month).padStart(2, "0")}.pdf`);
}

export function PayrollSection({
  section,
  records,
  staffOptions,
  structures,
  schoolName,
  employerKraPin,
  canGenerate,
  canApprove,
  canMarkPaid,
  canManageStructures,
}: {
  section: "runs" | "structures";
  records: PayrollRow[];
  staffOptions: StaffOption[];
  structures: SalaryStructureRow[];
  schoolName: string;
  employerKraPin: string | null;
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
  const [staffKraPin, setStaffKraPin] = useState("");
  const [staffNssfNumber, setStaffNssfNumber] = useState("");
  const [staffShifNumber, setStaffShifNumber] = useState("");
  const [staffNumber, setStaffNumber] = useState("");

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
    const structure = structures.find((s) => s.staff_id === teacherId);
    const result = await generatePayrollAction({
      teacher_id: teacherId,
      period_year: Number(periodYear),
      period_month: Number(periodMonth),
      gross_salary: Number(grossSalary),
      other_deductions: otherDeductions ? Number(otherDeductions) : 0,
      other_deductions_note: otherDeductionsNote || undefined,
      // Only attach the itemized breakdown when the totals still match what's on the
      // structure -- if the person hand-edited gross salary or other deductions in this
      // dialog after picking a staff member, the breakdown would no longer add up to the
      // figures actually being submitted, so it's safer to leave the payslip un-itemized
      // for that one run than to print a breakdown that doesn't reconcile.
      allowances_breakdown:
        structure && Number(grossSalary) === structure.basic_salary + structure.allowances.reduce((s, a) => s + a.amount, 0)
          ? structure.allowances.map((a) => ({ name: a.name, amount: a.amount }))
          : undefined,
      deductions_breakdown:
        structure && Number(otherDeductions || 0) === structure.deductions.reduce((s, d) => s + d.amount, 0)
          ? structure.deductions.map((d) => ({ name: d.name, amount: d.amount }))
          : undefined,
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
      setStaffKraPin(existing.staff_kra_pin ?? "");
      setStaffNssfNumber(existing.staff_nssf_number ?? "");
      setStaffShifNumber(existing.staff_shif_number ?? "");
      setStaffNumber(existing.staff_number ?? "");
    } else {
      setStructureStaffId("");
      setBasicSalary("");
      setAllowances([]);
      setDeductions([]);
      setStaffKraPin("");
      setStaffNssfNumber("");
      setStaffShifNumber("");
      setStaffNumber("");
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
    if ("error" in result) {
      setPending(false);
      return setError(result.error);
    }
    // Statutory numbers are a separate RPC (payroll.write, not staff.manage -- see the
    // migration) so a failure here shouldn't be silently swallowed, but also shouldn't be
    // conflated with the salary structure itself having failed to save above.
    if (staffKraPin || staffNssfNumber || staffShifNumber || staffNumber) {
      const idResult = await updateStaffStatutoryNumbersAction({
        staff_id: structureStaffId,
        kra_pin: staffKraPin,
        nssf_number: staffNssfNumber,
        shif_number: staffShifNumber,
        staff_number: staffNumber,
      });
      if ("error" in idResult) {
        setPending(false);
        return setError(`Salary structure saved, but statutory numbers failed: ${idResult.error}`);
      }
    }
    setPending(false);
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

      {section === "runs" && (
        <div>
          <div className="panel">
            <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div className="flex items-center gap-3">
                <h2 className="text-[0.8125rem] font-semibold">Payslips</h2>
                <span className="text-[0.6875rem] text-muted-foreground">
                  {records.length} payslip{records.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <TableExportMenu
                  filenameStub={`${schoolName}-payroll-register`}
                  title="Payroll Register"
                  subtitle={schoolName}
                  rows={records.map((r) => ({
                    "Staff": r.staff_name,
                    "Staff No.": r.staff_number ?? "",
                    Period: `${MONTHS[r.period_month - 1]} ${r.period_year}`,
                    "Gross Salary": r.gross_salary,
                    NSSF: r.nssf_employee,
                    SHIF: r.shif,
                    "Housing Levy": r.ahl,
                    PAYE: r.paye,
                    "Other Deductions": r.other_deductions,
                    "Net Pay": r.net_pay,
                    Status: r.status,
                  }))}
                />
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
              </div>
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
                              <Button size="sm" variant="ghost" onClick={() => downloadPayslip(schoolName, employerKraPin, r)}>
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
        </div>
      )}

      {section === "structures" && (canManageStructures || structures.length > 0) && (
        <div>
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

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Staff No.</Label>
                          <Input value={staffNumber} onChange={(e) => setStaffNumber(e.target.value)} placeholder="Optional" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>KRA PIN</Label>
                          <Input value={staffKraPin} onChange={(e) => setStaffKraPin(e.target.value)} placeholder="Optional" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>NSSF No.</Label>
                          <Input value={staffNssfNumber} onChange={(e) => setStaffNssfNumber(e.target.value)} placeholder="Optional" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>SHIF No.</Label>
                          <Input value={staffShifNumber} onChange={(e) => setStaffShifNumber(e.target.value)} placeholder="Optional" />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Staff number and statutory numbers print on this person&apos;s payslip when set. Leave any blank to omit that line.
                      </p>

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
        </div>
      )}
    </div>
  );
}
