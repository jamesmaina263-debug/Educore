"use client";

import { useSchoolHref } from "@/components/app-shell/school-slug-context";

/** Shown on Communication only for schools with WhatsApp bot guardian requests switched on. */
export function BotRequestsLink() {
  const toHref = useSchoolHref();
  return (
    <div className="panel p-3 text-sm text-muted-foreground">
      Guardians can send absence notes and phone-number changes to the school bot.{" "}
      <a href={toHref("/communication/bot-requests")} className="underline">
        Open Bot requests
      </a>
      .
    </div>
  );
}
