"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { checkMpesaCodeAction } from "@/app/(app)/finance/reconciliation/check-code-action";
import { isValidMpesaCode, verdictMessage, type MpesaCodeResult } from "@/lib/mpesa-code-check";

function fmtTime(v: string | null): string {
  return v ? new Date(v).toLocaleString() : "—";
}

/** "Check an M-Pesa code": one code in, where it appears out. Read-only. */
export function MpesaCodeCheck() {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MpesaCodeResult | null>(null);

  async function handleCheck() {
    setPending(true);
    setError(null);
    setResult(null);
    const res = await checkMpesaCodeAction(code);
    setPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setResult(res.result);
  }

  const badgeVariant = result?.verdict === "recorded" ? "default" : result?.verdict === "seen_not_recorded" ? "secondary" : "destructive";

  return (
    <div className="panel p-4">
      <p className="mb-1 text-sm font-semibold">Check an M-Pesa code</p>
      <p className="mb-3 text-sm text-muted-foreground">
        Type a code from a parent&apos;s M-Pesa SMS to see whether it is already recorded, appeared on an uploaded statement
        {" "}or was received by paybill auto-capture.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && isValidMpesaCode(code) && !pending) void handleCheck();
          }}
          placeholder="e.g. UK1030FRW6"
          className="max-w-xs font-mono"
          aria-label="M-Pesa code"
        />
        <Button onClick={handleCheck} disabled={pending || !isValidMpesaCode(code)}>
          {pending ? "Checking..." : "Check code"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {result && (
        <div className="mt-4 flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={badgeVariant}>{result.verdict === "recorded" ? "Recorded" : result.verdict === "seen_not_recorded" ? "Seen, not recorded" : "Not found"}</Badge>
            <span className="font-mono text-xs">{result.code}</span>
          </div>
          <p>{verdictMessage(result.verdict)}</p>
          {result.payments.length > 0 && (
            <div>
              <p className="font-medium">Payments</p>
              <ul className="list-disc pl-5">
                {result.payments.map((p) => (
                  <li key={p.payment_id}>
                    KES {p.amount.toLocaleString()} ({p.status}) on {fmtTime(p.recorded_at)} —{" "}
                    {p.student_name ? `${p.student_name}${p.admission_number ? ` (adm ${p.admission_number})` : ""}` : "not allocated to a student"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.statement_lines.length > 0 && (
            <div>
              <p className="font-medium">Uploaded statements</p>
              <ul className="list-disc pl-5">
                {result.statement_lines.map((l, i) => (
                  <li key={i}>
                    KES {l.amount.toLocaleString()} on {fmtTime(l.transaction_time)} — {l.match_status.replace(/_/g, " ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.c2b_events.length > 0 && (
            <div>
              <p className="font-medium">Paybill auto-capture</p>
              <ul className="list-disc pl-5">
                {result.c2b_events.map((e, i) => (
                  <li key={i}>
                    KES {e.amount.toLocaleString()} received {fmtTime(e.received_at)} — {e.outcome.replace(/_/g, " ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.verdict === "seen_not_recorded" && (
            <p className="text-muted-foreground">
              If this is a statement line, upload the statement below and use &quot;Record payment&quot; on the line.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
