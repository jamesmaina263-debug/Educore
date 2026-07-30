"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { inviteStaffMember } from "@/app/settings/actions";
import type { RoleOption } from "./staff-roles-table";

export function InviteStaffDialog({ roles }: { roles: RoleOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", role_id: roles[0]?.id ?? "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  async function handleInvite() {
    setPending(true);
    setError(null);
    const result = await inviteStaffMember(form);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setTempPassword(result.temporaryPassword);
    router.refresh();
  }

  function handleClose(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setForm({ full_name: "", email: "", role_id: roles[0]?.id ?? "" });
      setTempPassword(null);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button size="sm">Add staff</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tempPassword ? "Staff account created" : "Add staff member"}</DialogTitle>
        </DialogHeader>

        {tempPassword ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              No email invite is sent yet — share these sign-in details with{" "}
              <span className="font-medium text-foreground">{form.full_name}</span> directly. This password is only
              shown once.
            </p>
            <div className="rounded-md border border-border bg-muted p-3 font-mono text-sm">
              <div>{form.email}</div>
              <div className="mt-1 font-semibold">{tempPassword}</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role_id} onValueChange={(v) => setForm({ ...form, role_id: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {tempPassword ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : (
            <Button onClick={handleInvite} disabled={pending || !form.full_name || !form.email}>
              {pending ? "Creating…" : "Create account"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
