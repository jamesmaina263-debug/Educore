"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function ClaimApplicationButton({
  applicationId,
  isAssigned,
  claimAction,
}: {
  applicationId: string;
  isAssigned: boolean;
  claimAction: (applicationId: string) => Promise<{ error: string } | { success: true }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await claimAction(applicationId);
      if ("error" in result) {
        // Best-effort UI action — surface failures the same lightweight way other admissions
        // actions do (console + no state change) rather than adding a new toast/error pattern.
        console.error("claimApplicationAction failed:", result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="text-[0.8125rem] font-medium text-primary hover:underline disabled:opacity-50"
    >
      {pending ? "…" : isAssigned ? "Reassign to me" : "Claim"}
    </button>
  );
}
