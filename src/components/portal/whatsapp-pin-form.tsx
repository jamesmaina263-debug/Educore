"use client";

import { useState, useTransition } from "react";
import { setWhatsAppPinAction } from "@/app/portal/whatsapp-pin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WhatsAppPinForm({ hasPin }: { hasPin: boolean }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [saved, setSaved] = useState(hasPin);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!/^[0-9]{4,6}$/.test(pin)) {
      setMessage({ kind: "error", text: "The PIN must be 4 to 6 digits." });
      return;
    }
    if (pin !== confirm) {
      setMessage({ kind: "error", text: "The two PINs do not match." });
      return;
    }
    startTransition(async () => {
      const res = await setWhatsAppPinAction(pin);
      if ("error" in res) {
        setMessage({ kind: "error", text: res.error });
        return;
      }
      setPin("");
      setConfirm("");
      setSaved(true);
      setMessage({ kind: "ok", text: "Your WhatsApp PIN is saved." });
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {saved ? "You have a PIN. Enter a new one below to change it." : "You have not set a PIN yet."}
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wa-pin">New PIN (4 to 6 digits)</Label>
        <Input id="wa-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wa-pin2">Type it again</Label>
        <Input id="wa-pin2" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} />
      </div>
      {message && (
        <p role="status" className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-emerald-700"}>
          {message.text}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : saved ? "Change PIN" : "Save PIN"}
      </Button>
    </form>
  );
}
