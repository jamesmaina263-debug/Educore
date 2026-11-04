"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPayLinkStatus, startPayLinkPayment } from "./actions";

type Phase = "idle" | "sending" | "waiting" | "done" | "failed" | "timeout";

export function PayForm({ token, amountLabel }: { token: string; amountLabel: string }) {
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setPhase("sending");
    const result = await startPayLinkPayment(token, phone);
    if (!result.ok) {
      setPhase("idle");
      setMessage(result.message);
      return;
    }
    setPhase("waiting");
    let polls = 0;
    timer.current = setInterval(async () => {
      polls += 1;
      const { status } = await getPayLinkStatus(token, result.requestId);
      if (status === "completed") {
        if (timer.current) clearInterval(timer.current);
        setPhase("done");
      } else if (status === "failed" || status === "cancelled") {
        if (timer.current) clearInterval(timer.current);
        setPhase("failed");
      } else if (polls >= 25) {
        if (timer.current) clearInterval(timer.current);
        setPhase("timeout");
      }
    }, 3000);
  }

  if (phase === "done") {
    return <p className="rounded-md border p-3 text-sm">Payment received. Thank you. The school will see it shortly.</p>;
  }
  if (phase === "timeout") {
    return (
      <p className="rounded-md border p-3 text-sm">
        We are still waiting for M-Pesa. If you approved the prompt, the school will see your payment shortly. Do not pay again.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {phase === "failed" && (
        <p className="rounded-md border p-3 text-sm">The payment was not completed. You can try again below.</p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="phone">Your M-Pesa number</Label>
        <Input
          id="phone"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0712 345 678"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={phase === "sending" || phase === "waiting"}
        />
      </div>
      <Button type="submit" className="w-full" disabled={phase === "sending" || phase === "waiting" || !phone.trim()}>
        {phase === "sending" ? "Sending…" : phase === "waiting" ? "Check your phone…" : `Pay ${amountLabel}`}
      </Button>
      {phase === "waiting" && <p className="text-xs text-muted-foreground">Enter your M-Pesa PIN on the prompt that appears on your phone.</p>}
      {message && <p className="text-sm text-red-600">{message}</p>}
    </form>
  );
}
