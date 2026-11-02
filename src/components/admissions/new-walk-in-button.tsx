"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

// Submit button for the "+ New Walk-In Admission" form. It disables itself while the draft is being
// created, so an impatient second click can't start another one (four were created in five seconds
// before this).
export function NewWalkInButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} aria-busy={pending}>
      {pending ? "Starting…" : "+ New Walk-In Admission"}
    </Button>
  );
}
