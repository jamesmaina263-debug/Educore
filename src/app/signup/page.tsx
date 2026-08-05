import { getActivePlans } from "./actions";
import { SignupForm } from "./signup-form";

export default async function SignupPage() {
  const plans = await getActivePlans();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-4 rounded-md border border-border bg-surface p-6">
        <div>
          <h1 className="text-base font-semibold">Start your school on EduCore</h1>
          <p className="text-sm text-muted-foreground">
            30-day free trial, no card required. You&apos;ll be the school owner.
          </p>
        </div>
        <SignupForm plans={plans} />
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <a href="/login" className="underline underline-offset-2">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
