"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { sendSupplierMessageAction } from "@/app/(app)/communication/actions";

export interface SupplierOption {
  id: string;
  name: string;
  email: string | null;
}

export function SupplierComposeSection({ suppliers }: { suppliers: SupplierOption[] }) {
  const router = useRouter();
  const withEmail = suppliers.filter((s) => s.email);
  const [supplierId, setSupplierId] = useState(withEmail[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    setPending(true);
    setError(null);
    setSent(false);
    const res = await sendSupplierMessageAction({ supplier_id: supplierId, subject, body });
    setPending(false);
    if ("error" in res) return setError(res.error);
    setSent(true);
    setSubject("");
    setBody("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-danger">{error}</p>}
      {sent && <p className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">Email sent to supplier.</p>}

      <div className="panel max-w-3xl">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Message a supplier</h2>
        </header>
        <div className="flex flex-col gap-4 p-4">
          {withEmail.length === 0 ? (
            <p className="text-sm text-muted-foreground">No suppliers with an email address on file. Add one under Inventory &gt; Suppliers.</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Supplier</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {withEmail.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Subject</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Delivery follow-up" />
              </div>
              <div className="space-y-1.5">
                <Label>Message</Label>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
              </div>
              <Button onClick={handleSend} disabled={pending || !supplierId || !subject.trim() || !body.trim()} className="self-start">
                {pending ? "Sending…" : "Send"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
