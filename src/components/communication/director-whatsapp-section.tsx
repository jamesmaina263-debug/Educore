"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registerDirectorNumberAction, revokeDirectorNumberAction } from "@/app/(app)/communication/director-whatsapp/actions";
import type { DirectorWhatsappStatus } from "@/lib/director-whatsapp";

export function DirectorWhatsappSection({ status }: { status: DirectorWhatsappStatus }) {
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!status.eligible) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        Only a school owner, principal or deputy principal can use this.
      </div>
    );
  }

  function run(fn: () => Promise<{ error: string } | { success: true }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) setError(result.error);
      else setPhone("");
    });
  }

  if (status.registered) {
    return (
      <div className="panel flex flex-col gap-3 p-4 text-sm">
        <p>
          WhatsApp number <strong>{status.phoneMasked}</strong> is registered. Message the school&apos;s WhatsApp number from it and send <em>menu</em>, or ask
          in your own words (for example &quot;collections today&quot; or &quot;who is absent&quot;).
        </p>
        <div>
          <Button variant="outline" disabled={pending} onClick={() => run(revokeDirectorNumberAction)}>
            Remove this number
          </Button>
        </div>
        {error ? <p className="text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="panel flex flex-col gap-3 p-4 text-sm">
      <p>
        Register your own WhatsApp number to ask the school bot for figures. It must be the number on your staff profile. Replies only ever go to this
        number, and only when you ask.
      </p>
      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" inputMode="tel" aria-label="Your WhatsApp number" />
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        <span>I agree that EduCore may send my school&apos;s figures to this WhatsApp number when I ask for them.</span>
      </label>
      <div>
        <Button disabled={pending || !phone.trim() || !consent} onClick={() => run(() => registerDirectorNumberAction(phone, consent))}>
          Register number
        </Button>
      </div>
      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}
