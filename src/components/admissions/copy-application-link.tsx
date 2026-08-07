"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyApplicationLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/apply/${slug}`;

  async function handleCopy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (e.g. non-HTTPS) — the link is still visible to copy manually.
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <code className="rounded bg-muted px-2 py-1 text-xs">{path}</code>
      <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}
