"use client";

import { useActionState } from "react";
// Reused as-is, not duplicated: changePassword already does exactly what's
// needed here -- verify a real session exists (redirects to /login if not,
// which also covers someone landing here without ever going through
// /auth/confirm), validate + set the new password, and defensively clear
// must_change_password/temp_password_expires_at in case this reset was
// used to escape an expired-temp-password lockout rather than a genuine
// forgotten password. See change-password/actions.ts.
import { changePassword, type ChangePasswordState } from "@/app/change-password/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ChangePasswordState = { error: null };

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(changePassword, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        action={formAction}
        className="w-full max-w-sm space-y-4 rounded-md border border-border bg-surface p-6"
      >
        <div>
          <h1 className="text-base font-semibold">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">
            Set a new password for your account to finish resetting it.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm_password">Confirm new password</Label>
          <Input
            id="confirm_password"
            name="confirm_password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>

        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Save password and continue"}
        </Button>
      </form>
    </div>
  );
}
