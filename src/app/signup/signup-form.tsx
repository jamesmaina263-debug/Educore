"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpSchool, type SignupState, type Plan } from "./actions";

const initialState: SignupState = { error: null };

export function SignupForm({ plans }: { plans: Plan[] }) {
  const [state, formAction, pending] = useActionState(signUpSchool, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="school_name">School name</Label>
        <Input id="school_name" name="school_name" required />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="owner_name">Your name</Label>
          <Input id="owner_name" name="owner_name" required autoComplete="name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone (optional)</Label>
          <Input id="phone" name="phone" autoComplete="tel" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Plan</legend>
        {plans.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No plans are available right now — please contact support.
          </p>
        )}
        {plans.map((plan, i) => (
          <label
            key={plan.id}
            className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm has-[:checked]:border-foreground"
          >
            <input
              type="radio"
              name="plan_id"
              value={plan.id}
              required
              defaultChecked={i === 0}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{plan.name}</span>{" "}
              <span className="text-muted-foreground">
                — KES {plan.price_per_student_kes}/student/{plan.billing_period}
              </span>
              {plan.description && (
                <span className="block text-muted-foreground">{plan.description}</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending || plans.length === 0} className="w-full">
        {pending ? "Setting up your school…" : "Start free trial"}
      </Button>
    </form>
  );
}
