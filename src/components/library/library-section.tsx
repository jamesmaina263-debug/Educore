"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  createLibraryItemAction,
  issueLoanAction,
  issueLoanToStaffAction,
  returnLoanAction,
  markLoanLostOrDamagedAction,
  createShelfAction,
  createReservationAction,
  cancelReservationAction,
  createFineAction,
  resolveFineAction,
  adjustCopiesAction,
} from "@/app/(app)/library/actions";

export interface LibraryItemRow {
  id: string;
  title: string;
  author: string | null;
  category: string | null;
  total_copies: number;
  available_copies: number;
  shelf_name: string | null;
}

export interface LoanRow {
  id: string;
  library_item_id: string;
  item_title: string;
  borrower_name: string;
  borrowed_at: string;
  due_date: string;
  returned_at: string | null;
  status: "borrowed" | "returned" | "lost" | "damaged";
}

export interface StudentOption {
  id: string;
  name: string;
}
export interface StaffOption {
  id: string;
  name: string;
}
export interface ShelfOption {
  id: string;
  name: string;
  location: string | null;
}
export interface ReservationRow {
  id: string;
  library_item_id: string;
  item_title: string;
  borrower_name: string;
  status: "pending" | "ready" | "fulfilled" | "cancelled";
  reserved_at: string;
}
export interface FineRow {
  id: string;
  loan_id: string;
  item_title: string;
  borrower_name: string;
  amount: number;
  reason: string;
  status: "unpaid" | "paid" | "waived";
  created_at: string;
}

function defaultDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

export function LibrarySection({
  section,
  items,
  loans,
  studentOptions,
  staffOptions,
  shelfOptions,
  reservations,
  fines,
  canWrite,
}: {
  section: "catalogue" | "shelves" | "reservations" | "fines";
  items: LibraryItemRow[];
  loans: LoanRow[];
  studentOptions: StudentOption[];
  staffOptions: StaffOption[];
  shelfOptions: ShelfOption[];
  reservations: ReservationRow[];
  fines: FineRow[];
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
  const [borrowerType, setBorrowerType] = useState<"student" | "staff">("student");
  const [issueItemId, setIssueItemId] = useState("");
  const [issueBorrowerId, setIssueBorrowerId] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate());

  const [shelfOpen, setShelfOpen] = useState(false);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [reserveItemId, setReserveItemId] = useState("");
  const [reserveBorrowerType, setReserveBorrowerType] = useState<"student" | "staff">("student");
  const [reserveBorrowerId, setReserveBorrowerId] = useState("");

  const [fineOpen, setFineOpen] = useState<string | null>(null);

  const [adjustOpen, setAdjustOpen] = useState<string | null>(null);
  const [adjustMode, setAdjustMode] = useState<"add" | "remove">("add");
  const [adjustCount, setAdjustCount] = useState("1");
  const [adjustAlreadyUnavailable, setAdjustAlreadyUnavailable] = useState(false);

  async function handleAdjustCopies(item: LibraryItemRow) {
    const n = Number(adjustCount);
    if (!n || n <= 0) return;
    setPending(true);
    setError(null);
    const total_delta = adjustMode === "add" ? n : -n;
    const available_delta = adjustMode === "add" ? n : adjustAlreadyUnavailable ? 0 : -n;
    const result = await adjustCopiesAction({ item_id: item.id, total_delta, available_delta });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setAdjustOpen(null);
    setAdjustCount("1");
    setAdjustMode("add");
    setAdjustAlreadyUnavailable(false);
    router.refresh();
  }

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
    const result =
      borrowerType === "student"
        ? await issueLoanAction({ library_item_id: issueItemId, student_id: issueBorrowerId, due_date: dueDate })
        : await issueLoanToStaffAction({ library_item_id: issueItemId, staff_id: issueBorrowerId, due_date: dueDate });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setIssueOpen(false);
    setIssueItemId("");
    setIssueBorrowerId("");
    router.refresh();
  }

  async function handleReturn(id: string) {
    setPending(true);
    const result = await returnLoanAction(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleMarkLostOrDamaged(loan: LoanRow, status: "lost" | "damaged") {
    setPending(true);
    const result = await markLoanLostOrDamagedAction({ loan_id: loan.id, item_id: loan.library_item_id, status });
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleCancelReservation(id: string) {
    setPending(true);
    const result = await cancelReservationAction(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleResolveFine(id: string, status: "paid" | "waived") {
    setPending(true);
    const result = await resolveFineAction({ fine_id: id, status });
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      {section === "catalogue" && (
        <div className="flex flex-col gap-6">
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
                          <Label>Borrower type</Label>
                          <Select
                            value={borrowerType}
                            onValueChange={(v) => {
                              setBorrowerType(v as "student" | "staff");
                              setIssueBorrowerId("");
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="student">Student</SelectItem>
                              <SelectItem value="staff">Staff</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>{borrowerType === "student" ? "Student" : "Staff member"}</Label>
                          <Select value={issueBorrowerId} onValueChange={setIssueBorrowerId}>
                            <SelectTrigger>
                              <SelectValue placeholder={`Select ${borrowerType}`} />
                            </SelectTrigger>
                            <SelectContent>
                              {(borrowerType === "student" ? studentOptions : staffOptions).map((s) => (
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
                        <Button onClick={handleIssue} disabled={pending || !issueItemId || !issueBorrowerId}>
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
                      <th>Shelf</th>
                      <th>Available</th>
                      {canWrite && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id}>
                        <td className="font-medium">{i.title}</td>
                        <td className="text-muted-foreground">{i.author ?? "—"}</td>
                        <td className="text-muted-foreground">{i.category ?? "—"}</td>
                        <td className="text-muted-foreground">{i.shelf_name ?? "—"}</td>
                        <td data-numeric>
                          {i.available_copies} / {i.total_copies}
                        </td>
                        {canWrite && (
                          <td>
                            <Dialog
                              open={adjustOpen === i.id}
                              onOpenChange={(o) => {
                                setAdjustOpen(o ? i.id : null);
                                if (!o) {
                                  setAdjustCount("1");
                                  setAdjustMode("add");
                                  setAdjustAlreadyUnavailable(false);
                                  setError(null);
                                }
                              }}
                            >
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline">Adjust copies</Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Adjust copies — {i.title}</DialogTitle>
                                </DialogHeader>
                                <div className="flex flex-col gap-3">
                                  <div className="space-y-1.5">
                                    <Label>Reason</Label>
                                    <Select value={adjustMode} onValueChange={(v) => setAdjustMode(v as "add" | "remove")}>
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="add">New copies purchased</SelectItem>
                                        <SelectItem value="remove">Lost, damaged, or withdrawn</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1.5">
                                    <Label>Number of copies</Label>
                                    <Input type="number" min={1} value={adjustCount} onChange={(e) => setAdjustCount(e.target.value)} />
                                  </div>
                                  {adjustMode === "remove" && (
                                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                                      <input
                                        type="checkbox"
                                        checked={adjustAlreadyUnavailable}
                                        onChange={(e) => setAdjustAlreadyUnavailable(e.target.checked)}
                                      />
                                      This copy was already out on loan (don&apos;t also reduce the available count)
                                    </label>
                                  )}
                                  <p className="text-xs text-muted-foreground">
                                    Current: {i.available_copies} available / {i.total_copies} total.
                                  </p>
                                  {error && <p className="text-sm text-danger">{error}</p>}
                                </div>
                                <DialogFooter>
                                  <Button onClick={() => handleAdjustCopies(i)} disabled={pending || !adjustCount || Number(adjustCount) <= 0}>
                                    {pending ? "Saving…" : "Save"}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          </td>
                        )}
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
                      <th>Borrower</th>
                      <th>Due</th>
                      <th>Status</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loans.map((l) => (
                      <tr key={l.id}>
                        <td className="font-medium">{l.item_title}</td>
                        <td className="text-muted-foreground">{l.borrower_name}</td>
                        <td className="text-muted-foreground">{l.due_date}</td>
                        <td>
                          <StatusBadge
                            tone={l.status === "returned" ? "success" : l.status === "lost" || l.status === "damaged" ? "danger" : "neutral"}
                            label={l.status}
                          />
                        </td>
                        <td className="text-right">
                          {canWrite && l.status === "borrowed" && (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleReturn(l.id)}>
                                Return
                              </Button>
                              <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleMarkLostOrDamaged(l, "lost")}>
                                Lost
                              </Button>
                              <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleMarkLostOrDamaged(l, "damaged")}>
                                Damaged
                              </Button>
                              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setFineOpen(l.id)}>
                                Fine
                              </Button>
                            </div>
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
      )}

      {section === "shelves" && canWrite && (
        <div className="panel">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <h2 className="text-[0.8125rem] font-semibold">Shelves</h2>
                  <span className="text-[0.6875rem] text-muted-foreground">{shelfOptions.length}</span>
                </div>
                <Dialog open={shelfOpen} onOpenChange={setShelfOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline">
                      Add Shelf
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Shelf</DialogTitle>
                    </DialogHeader>
                    <form
                      className="flex flex-col gap-3"
                      action={async (fd) => {
                        setPending(true);
                        setError(null);
                        const result = await createShelfAction(fd);
                        setPending(false);
                        if ("error" in result) return setError(result.error);
                        setShelfOpen(false);
                        router.refresh();
                      }}
                    >
                      <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input name="name" placeholder="e.g. Shelf A1" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Location</Label>
                        <Input name="location" placeholder="e.g. Main hall, left wall" />
                      </div>
                      <DialogFooter>
                        <Button type="submit" disabled={pending}>
                          Save
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </header>
              {shelfOptions.length === 0 ? (
                <p className="p-10 text-center text-sm text-muted-foreground">No shelves set up yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-dense w-full">
                    <thead className="bg-muted/70">
                      <tr>
                        <th>Name</th>
                        <th>Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shelfOptions.map((s) => (
                        <tr key={s.id}>
                          <td className="font-medium">{s.name}</td>
                          <td className="text-muted-foreground">{s.location ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
        )}

      {section === "reservations" && canWrite && (
        <div className="panel">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <h2 className="text-[0.8125rem] font-semibold">Reservations</h2>
                  <span className="text-[0.6875rem] text-muted-foreground">{reservations.length}</span>
                </div>
                <Dialog open={reserveOpen} onOpenChange={setReserveOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline">
                      New Reservation
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>New Reservation</DialogTitle>
                    </DialogHeader>
                    <form
                      className="flex flex-col gap-3"
                      action={async (fd) => {
                        setPending(true);
                        setError(null);
                        const result = await createReservationAction(fd);
                        setPending(false);
                        if ("error" in result) return setError(result.error);
                        setReserveOpen(false);
                        setReserveItemId("");
                        setReserveBorrowerId("");
                        router.refresh();
                      }}
                    >
                      <div className="space-y-1.5">
                        <Label>Item</Label>
                        <Select name="library_item_id" value={reserveItemId} onValueChange={setReserveItemId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select item" />
                          </SelectTrigger>
                          <SelectContent>
                            {items.map((i) => (
                              <SelectItem key={i.id} value={i.id}>
                                {i.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Borrower type</Label>
                        <Select
                          value={reserveBorrowerType}
                          onValueChange={(v) => {
                            setReserveBorrowerType(v as "student" | "staff");
                            setReserveBorrowerId("");
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="student">Student</SelectItem>
                            <SelectItem value="staff">Staff</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>{reserveBorrowerType === "student" ? "Student" : "Staff member"}</Label>
                        <Select
                          name={reserveBorrowerType === "student" ? "student_id" : "staff_id"}
                          value={reserveBorrowerId}
                          onValueChange={setReserveBorrowerId}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={`Select ${reserveBorrowerType}`} />
                          </SelectTrigger>
                          <SelectContent>
                            {(reserveBorrowerType === "student" ? studentOptions : staffOptions).map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <DialogFooter>
                        <Button type="submit" disabled={pending || !reserveItemId || !reserveBorrowerId}>
                          Save
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </header>
              {reservations.length === 0 ? (
                <p className="p-10 text-center text-sm text-muted-foreground">No active reservations.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-dense w-full">
                    <thead className="bg-muted/70">
                      <tr>
                        <th>Item</th>
                        <th>Borrower</th>
                        <th>Reserved</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {reservations.map((r) => (
                        <tr key={r.id}>
                          <td className="font-medium">{r.item_title}</td>
                          <td className="text-muted-foreground">{r.borrower_name}</td>
                          <td className="text-muted-foreground">{new Date(r.reserved_at).toLocaleDateString()}</td>
                          <td>
                            <StatusBadge tone="neutral" label={r.status} />
                          </td>
                          <td className="text-right">
                            <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleCancelReservation(r.id)}>
                              Cancel
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
        )}

      {section === "fines" && canWrite && (
        <div className="panel">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <h2 className="text-[0.8125rem] font-semibold">Fines</h2>
                <span className="text-[0.6875rem] text-muted-foreground">{fines.length}</span>
              </header>
              {fines.length === 0 ? (
                <p className="p-10 text-center text-sm text-muted-foreground">No fines recorded.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-dense w-full">
                    <thead className="bg-muted/70">
                      <tr>
                        <th>Item</th>
                        <th>Borrower</th>
                        <th>Reason</th>
                        <th className="text-right">Amount</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {fines.map((f) => (
                        <tr key={f.id}>
                          <td className="font-medium">{f.item_title}</td>
                          <td className="text-muted-foreground">{f.borrower_name}</td>
                          <td className="text-muted-foreground">{f.reason}</td>
                          <td className="text-right" data-numeric>
                            {f.amount.toLocaleString()}
                          </td>
                          <td>
                            <StatusBadge tone={f.status === "paid" ? "success" : f.status === "waived" ? "neutral" : "warning"} label={f.status} />
                          </td>
                          <td className="text-right">
                            {f.status === "unpaid" && (
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleResolveFine(f.id, "paid")}>
                                  Paid
                                </Button>
                                <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleResolveFine(f.id, "waived")}>
                                  Waive
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
        )}

      {fineOpen && (
        <Dialog open={!!fineOpen} onOpenChange={(o) => !o && setFineOpen(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Fine</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-3"
              action={async (fd) => {
                setPending(true);
                setError(null);
                const result = await createFineAction(fd);
                setPending(false);
                if ("error" in result) return setError(result.error);
                setFineOpen(null);
                router.refresh();
              }}
            >
              <input type="hidden" name="loan_id" value={fineOpen} />
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" step="0.01" name="amount" required />
              </div>
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Input name="reason" placeholder="e.g. Overdue 5 days" required />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
