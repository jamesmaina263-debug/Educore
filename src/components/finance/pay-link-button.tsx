"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPayLinkAction } from "@/app/(app)/finance/pay-link-actions";

// Staff-only. Creates a Pay by Link for the amount currently typed in the payment form and shows
// it once so staff can copy it. Nothing is sent to anyone from here.
export function PayLinkButton({
  studentId,
  invoiceId,
  amount,
  canCreate,
}: {
  studentId: string;
  invoiceId?: string;
  amount: string;
  canCreate: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [expires, setExpires] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const amountNumber = Number(amount);

  async function create() {
    setPending(true);
    setMessage(null);
    const result = await createPayLinkAction({ studentId, invoiceId, amount: amountNumber });
    setPending(false);
    if ("error" in result) {
      setUrl(null);
      setMessage(result.error);
      return;
    }
    setUrl(result.url);
    setExpires(new Date(result.expiresAt).toLocaleString("en-KE"));
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Copied.");
    } catch {
      setMessage("Could not copy. Select the link and copy it manually.");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="outline" size="sm" onClick={create} disabled={!canCreate || pending || !studentId || !amountNumber || amountNumber <= 0}>
        {pending ? "Creating…" : "Create pay link"}
      </Button>
      {url && (
        <div className="space-y-1">
          <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={copy}>Copy link</Button>
            <p className="text-xs text-muted-foreground">Shown once. Expires {expires}.</p>
          </div>
        </div>
      )}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
