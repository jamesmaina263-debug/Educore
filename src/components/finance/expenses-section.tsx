"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { raiseExpenseAction, approveExpenseAction, rejectExpenseAction } from "@/app/finance/actions";

export interface ExpenseRow {
  id: string;
  category: string;
  vendor: string;
  amount: number;
  description: string | null;
  status: "pending" | "approved" | "rejected";
}

export function ExpensesSection({
  expenses,
  approvalThreshold,
  canRaise,
  canApprove,
}: {
  expenses: ExpenseRow[];
  approvalThreshold: number | null;
  canRaise: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  async function handleRaise() {
    setPending(true);
    setError(null);
    const result = await raiseExpenseAction({ category, vendor, amount: Number(amount), description: description || undefined });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setCategory("");
    setVendor("");
    setAmount("");
    setDescription("");
    router.refresh();
  }

  async function handleApprove(id: string) {
    setPending(true);
    const result = await approveExpenseAction(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleReject(id: string) {
    setPending(true);
    const result = await rejectExpenseAction(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {approvalThreshold !== null
            ? `Expenses of KES ${approvalThreshold.toLocaleString()} or less self-approve; above that, Principal/Owner sign-off is required.`
            : "No approval threshold set — every expense requires Principal/Owner approval."}
        </p>
        {canRaise && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Raise expense
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Raise an expense</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Category</Label>
                    <Input placeholder="Stationery" value={category} onChange={(e) => setCategory(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Vendor</Label>
                    <Input placeholder="Text Book Centre" value={vendor} onChange={(e) => setVendor(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Amount</Label>
                  <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Description (optional)</Label>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
              <DialogFooter>
                <Button onClick={handleRaise} disabled={pending || !category.trim() || !vendor.trim() || !amount}>
                  {pending ? "Submitting…" : "Submit"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {expenses.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No expenses recorded yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              {canApprove && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.category}</TableCell>
                <TableCell>{e.vendor}</TableCell>
                <TableCell>{e.amount.toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={e.status === "approved" ? "success" : e.status === "rejected" ? "danger" : "secondary"}>
                    {e.status}
                  </Badge>
                </TableCell>
                {canApprove && (
                  <TableCell className="text-right">
                    {e.status === "pending" && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" disabled={pending} onClick={() => handleApprove(e.id)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleReject(e.id)}>
                          Reject
                        </Button>
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
