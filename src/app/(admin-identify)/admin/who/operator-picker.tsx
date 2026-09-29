"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserRound, ArrowLeft } from "lucide-react";
import { AuthLayout } from "@/components/shared/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADMIN_OPERATORS, ADMIN_OPERATOR_EMAILS, type AdminOperator } from "@/lib/admin-operator";
import { requestOperatorCode, confirmOperatorCode } from "./otp-actions";
import { maskEmail } from "./mask-email";

export function OperatorPicker({ next, current }: { next: string; current: AdminOperator | null }) {
  const router = useRouter();
  const [step, setStep] = useState<"pick" | "code">("pick");
  const [operator, setOperator] = useState<AdminOperator | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pick(name: AdminOperator) {
    setError(null);
    setOperator(name);
    startTransition(async () => {
      const result = await requestOperatorCode(name);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setCode("");
      setStep("code");
    });
  }

  function submitCode(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!operator) return;
    setError(null);
    startTransition(async () => {
      const result = await confirmOperatorCode(operator, code, next);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(result.next);
    });
  }

  if (step === "code" && operator) {
    return (
      <AuthLayout>
        <form
          onSubmit={submitCode}
          className="space-y-5 rounded-xl border border-border bg-surface p-7 shadow-raised sm:p-8"
        >
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("pick");
              }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3" /> Not {operator}?
            </button>
            <h1 className="text-lg font-semibold tracking-tight">Enter your code</h1>
            <p className="text-sm text-muted-foreground">
              We sent a 6-digit code to {maskEmail(ADMIN_OPERATOR_EMAILS[operator])}. It expires in
              10 minutes.
            </p>
          </div>

          <Input
            autoFocus
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="text-center text-lg tracking-[0.4em]"
          />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" disabled={isPending || code.length !== 6} className="h-11 w-full">
            {isPending ? "Verifying…" : "Verify"}
          </Button>

          <button
            type="button"
            disabled={isPending}
            onClick={() => pick(operator)}
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Resend code
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="space-y-5 rounded-xl border border-border bg-surface p-7 shadow-raised sm:p-8">
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Who are you logging in as?</h1>
          <p className="text-sm text-muted-foreground">
            The admin console uses one shared login. Pick your name, then confirm with the code we
            email you, so what you do here is recorded against you in the activity log.
          </p>
        </div>

        <div className="space-y-2">
          {ADMIN_OPERATORS.map((name) => (
            <Button
              key={name}
              type="button"
              disabled={isPending}
              onClick={() => pick(name)}
              variant={name === current ? "default" : "outline"}
              className="h-11 w-full justify-start gap-2"
            >
              <UserRound className="size-4" />
              {name}
            </Button>
          ))}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </AuthLayout>
  );
}
