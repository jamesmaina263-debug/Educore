"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { initiateMpesaPush, getMpesaRequestStatus } from "@/app/(app)/integrations/actions";

// Drop-in "Push STK Prompt" trigger used everywhere a fee amount + phone number + student are
// already known: Finance > Student Accounts, Finance > Invoices, and the Admissions wizard's
// Finance step. Reads amount/phone from the caller's own form fields (never owns its own —
// keeps this a single source of truth per screen) and reuses the same
// initiate_mpesa_stk_request -> poll -> onResolved flow the Integrations push panel uses.
export function MpesaPushTrigger({
  studentId,
  amount,
  phoneNumber,
  invoiceId,
  notes,
  isActive,
  canPush,
  onResolved,
}: {
  studentId: string;
  amount: string;
  phoneNumber: string;
  invoiceId?: string;
  notes?: string;
  isActive: boolean;
  canPush: boolean;
  onResolved?: (status: "completed" | "failed" | "cancelled") => void;
}) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<"idle" | "waiting" | "resolved">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const amountNumber = Number(amount);
  const disabled = !canPush || !isActive || pending || !studentId || !phoneNumber || !amountNumber || amountNumber <= 0;

  async function handlePush() {
    setPending(true);
    setStatus("waiting");
    setMessage(null);

    const result = await initiateMpesaPush({
      studentId,
      amount: amountNumber,
      phoneNumber,
      invoiceId,
      notes,
    });

    if ("error" in result) {
      setPending(false);
      setStatus("idle");
      setMessage(result.error);
      return;
    }

    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      const check = await getMpesaRequestStatus(result.requestId);
      if ("success" in check && check.status !== "pending") {
        if (pollRef.current) clearInterval(pollRef.current);
        setPending(false);
        setStatus("resolved");
        setMessage(
          check.status === "completed"
            ? "Payment confirmed."
            : check.resultDesc ?? "The prompt was not completed.",
        );
        onResolved?.(check.status as "completed" | "failed" | "cancelled");
      } else if (attempts >= 20) {
        if (pollRef.current) clearInterval(pollRef.current);
        setPending(false);
        setStatus("resolved");
        setMessage("Still waiting on a response — check Integrations > M-Pesa for the latest status.");
      }
    }, 3000);
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="secondary" size="sm" onClick={handlePush} disabled={disabled}>
        {status === "waiting" ? "Waiting for response…" : "Push STK prompt"}
      </Button>
      {!isActive && <p className="text-xs text-muted-foreground">M-Pesa isn&apos;t activated for this school yet.</p>}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
