import type { Metadata } from "next";
import { AuthLayout } from "@/components/shared/auth-layout";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Sign Up — EduCore",
  description: "Set up your institution on EduCore. 30-day free trial, no card required.",
};

export default function SignupPage() {
  return (
    <AuthLayout contentClassName="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Sign Up With Us!</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          30-day free trial, no card required. You&apos;ll be the institution owner.
        </p>
      </div>
      <SignupForm />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <a href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
          Sign in
        </a>
      </p>
    </AuthLayout>
  );
}
