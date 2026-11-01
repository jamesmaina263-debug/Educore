"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { setC2bModeAction } from "@/app/(app)/finance/paybill/actions";
import {
  LIVE_CONFIRMATION_WORD,
  canOfferLive,
  isLiveConfirmationValid,
  matchRuleLabel,
  outcomeMeta,
  type C2bMode,
} from "@/lib/c2b-events";
import { attentionLines } from "@/lib/c2b-attention";
import type { C2bAttention } from "@/app/(app)/finance/paybill/attention";

export interface PaybillModeInfo {
  exists: boolean;
  mode: C2bMode | null;
  registered: boolean;
}

export interface PaybillEventRow {
  id: string;
  externalId: string;
  amount: number;
  accountReference: string | null;
  phoneMasked: string | null;
  transactionTime: string;
  outcome: string;
  matchRule: string | null;
  wouldBe: string | null;
  learner: string | null;
  hasPayment: boolean;
}

function fmtKes(n: number) {
  return `KES ${n.toLocaleString()}`;
}

export function PaybillSection({
  mode,
  events,
  isOwner,
  isTill = false,
  attention,
}: {
  mode: PaybillModeInfo;
  events: PaybillEventRow[];
  isOwner: boolean;
  isTill?: boolean;
  attention?: C2bAttention;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  function change(next: C2bMode) {
    setError(null);
    startTransition(async () => {
      const result = await setC2bModeAction(next, next === "live" ? typed : undefined);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      setTyped("");
    });
  }

  const offerLive = canOfferLive({ exists: mode.exists, mode: mode.mode, registered: mode.registered, isOwner, isTill });

  const attentionText = attention ? attentionLines(attention) : [];

  return (
    <div className="flex flex-col gap-6">
      {attentionText.length > 0 && attention && (
        <div role="alert" className="panel flex flex-col gap-2 border-warning/40 bg-warning-subtle p-4 text-sm">
          <p className="font-semibold">Needs attention</p>
          {attentionText.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {attention.failed.length > 0 && (
            <ul className="list-disc pl-5 font-mono text-xs">
              {attention.failed.map((f) => (
                <li key={f.id}>
                  {f.externalId} · {fmtKes(f.amount)} · account {f.accountReference ?? "—"} ·{" "}
                  {new Date(f.at).toLocaleString()}
                </li>
              ))}
              {attention.failedCount > attention.failed.length && (
                <li>…and {attention.failedCount - attention.failed.length} more in the list below</li>
              )}
            </ul>
          )}
        </div>
      )}
      {isTill && (
        <div className="panel border-warning/40 bg-warning-subtle p-4 text-sm">
          The M-Pesa number for your school is a till (Buy Goods). A till payment carries no account number, so it cannot be
          matched to a learner automatically; paybill auto-capture needs a paybill. M-Pesa prompts and statement upload
          keep working for your till.
        </div>
      )}
      <div className="panel flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold">Mode</p>
          {!mode.exists && <StatusBadge tone="neutral" label="Not set up" />}
          {mode.exists && mode.mode === "log_only" && <StatusBadge tone="info" label="Log only" />}
          {mode.exists && mode.mode === "live" && <StatusBadge tone="success" label="Live" />}
          {mode.exists && (
            <StatusBadge
              tone={mode.registered ? "success" : "warning"}
              label={mode.registered ? "URL registered" : "URL not registered"}
            />
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          {!mode.exists &&
            "Paybill auto-capture has not been set up for your school yet. Your EduCore administrator will set it up."}
          {mode.exists &&
            mode.mode === "log_only" &&
            "In log-only mode, every paybill payment is recorded below with what EduCore would have done, but no payment is created and no balance changes."}
          {mode.exists &&
            mode.mode === "live" &&
            "In live mode, a payment whose account number matches exactly one learner is recorded and allocated automatically. Anything uncertain goes to a person."}
        </p>

        {mode.exists && mode.mode === "log_only" && !mode.registered && (
          <p className="text-sm text-muted-foreground">
            Going live becomes available once the confirmation URL has been registered with Safaricom.
          </p>
        )}

        {mode.exists && !isOwner && (
          <p className="text-sm text-muted-foreground">Only the school owner can change the mode.</p>
        )}

        {isOwner && mode.exists && mode.mode === "live" && (
          <div>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => change("log_only")}>
              {pending ? "Saving…" : "Switch back to log only"}
            </Button>
          </div>
        )}

        {offerLive && !confirming && (
          <div>
            <Button size="sm" onClick={() => setConfirming(true)}>
              Switch to live…
            </Button>
          </div>
        )}

        {offerLive && confirming && (
          <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-subtle p-3">
            <p className="text-sm">
              Going live starts recording and allocating real payments automatically. Type{" "}
              <span className="font-mono font-semibold">{LIVE_CONFIRMATION_WORD}</span> to confirm.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={LIVE_CONFIRMATION_WORD}
                aria-label="Type LIVE to confirm"
                className="max-w-[10rem]"
                autoComplete="off"
              />
              <Button size="sm" disabled={pending || !isLiveConfirmationValid(typed)} onClick={() => change("live")}>
                {pending ? "Saving…" : "Go live"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setConfirming(false);
                  setTyped("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">Recent paybill payments ({events.length})</p>
        {events.length === 0 ? (
          <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">
            No paybill payments have been received yet.
          </div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Account no.</th>
                  <th className="px-3 py-2 font-medium">Learner</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                  <th className="px-3 py-2 font-medium">Detail</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const meta = outcomeMeta(e.outcome);
                  const detail = [matchRuleLabel(e.matchRule), e.wouldBe ? `Would: ${e.wouldBe}` : "", e.hasPayment ? "Payment recorded" : ""]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-2">{new Date(e.transactionTime).toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2">{fmtKes(e.amount)}</td>
                      <td className="px-3 py-2 font-mono">{e.accountReference ?? "—"}</td>
                      <td className="px-3 py-2">{e.learner ?? "—"}</td>
                      <td className="px-3 py-2">
                        <StatusBadge tone={meta.tone} label={meta.label} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{detail || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono">{e.phoneMasked ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
