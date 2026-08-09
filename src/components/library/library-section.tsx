"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createLibraryItemAction, issueLoanAction, returnLoanAction } from "@/app/library/actions";

export interface LibraryItemRow {
  id: string;
  title: string;
  author: string | null;
  category: string | null;
  total_copies: number;
  available_copies: number;
}

export interface LoanRow {
  id: string;
  item_title: string;
  student_name: string;
  borrowed_at: string;
  due_date: string;
  returned_at: string | null;
  status: "borrowed" | "returned" | "lost";
}

export interface StudentOption {
  id: string;
  name: string;
}

function defaultDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

export function LibrarySection({
  items,
  loans,
  studentOptions,
  canWrite,
}: {
  items: LibraryItemRow[];
  loans: LoanRow[];
  studentOptions: StudentOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [category, setCategory] = useState("");
  const [totalCopies, setTotalCopies] = useState("1");

  const [issueOpen, setIssueOpen] = useState(false);
  const [issueItemId, setIssueItemId] = useState("");
  const [issueStudentId, setIssueStudentId] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate());

  async function handleAddItem() {
    setPending(true);
    setError(null);
    const result = await createLibraryItemAction({ title, author, category, total_copies: Number(totalCopies) });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setAddOpen(false);
    setTitle("");
    setAuthor("");
    setCategory("");
    setTotalCopies("1");
    router.refresh();
  }

  async function handleIssue() {
    setPending(true);
    setError(null);
    const result = await issueLoanAction({ library_item_id: issueItemId, student_id: issueStudentId, due_date: dueDate });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setIssueOpen(false);
    setIssueItemId("");
    setIssueStudentId("");
    router.refresh();
  }

  async function handleReturn(id: string) {
    setPending(true);
    const result = await returnLoanAction(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-3">
            <h2 className="text-[0.8125rem] font-semibold">Catalogue</h2>
            <span className="text-[0.6875rem] text-muted-foreground">
              {items.length} title{items.length === 1 ? "" : "s"}
            </span>
          </div>
          {canWrite && (
            <div className="flex gap-2">
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    Add item
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add a library item</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>Title</Label>
                      <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Author</Label>
                        <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Category</Label>
                        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Fiction, Set text…" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Total copies</Label>
                      <Input type="number" min={1} value={totalCopies} onChange={(e) => setTotalCopies(e.target.value)} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleAddItem} disabled={pending || !title}>
                      {pending ? "Adding…" : "Add item"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">Issue loan</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Issue a loan</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>Item</Label>
                      <Select value={issueItemId} onValueChange={setIssueItemId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select item" />
                        </SelectTrigger>
                        <SelectContent>
                          {items
                            .filter((i) => i.available_copies > 0)
                            .map((i) => (
                              <SelectItem key={i.id} value={i.id}>
                                {i.title} ({i.available_copies} available)
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Student</Label>
                      <Select value={issueStudentId} onValueChange={setIssueStudentId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select student" />
                        </SelectTrigger>
                        <SelectContent>
                          {studentOptions.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Due date</Label>
                      <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleIssue} disabled={pending || !issueItemId || !issueStudentId}>
                      {pending ? "Issuing…" : "Issue"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </header>

        {items.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No items catalogued yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Title</th>
                  <th>Author</th>
                  <th>Category</th>
                  <th>Available</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="font-medium">{i.title}</td>
                    <td className="text-muted-foreground">{i.author ?? "—"}</td>
                    <td className="text-muted-foreground">{i.category ?? "—"}</td>
                    <td data-numeric>
                      {i.available_copies} / {i.total_copies}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Loans</h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            {loans.length} loan{loans.length === 1 ? "" : "s"}
          </span>
        </header>
        {loans.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No loans yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Item</th>
                  <th>Student</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l) => (
                  <tr key={l.id}>
                    <td className="font-medium">{l.item_title}</td>
                    <td className="text-muted-foreground">{l.student_name}</td>
                    <td className="text-muted-foreground">{l.due_date}</td>
                    <td>
                      <StatusBadge
                        tone={l.status === "returned" ? "success" : l.status === "lost" ? "danger" : "neutral"}
                        label={l.status}
                      />
                    </td>
                    <td className="text-right">
                      {canWrite && l.status === "borrowed" && (
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleReturn(l.id)}>
                          Mark returned
                        </Button>
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
