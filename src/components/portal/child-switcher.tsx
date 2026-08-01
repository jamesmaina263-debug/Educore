"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ChildSwitcher({
  options,
  selectedId,
}: {
  options: { id: string; name: string }[];
  selectedId: string;
}) {
  const router = useRouter();

  if (options.length <= 1) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((c) => (
        <Button
          key={c.id}
          size="sm"
          variant={c.id === selectedId ? "default" : "outline"}
          onClick={() => router.push(`/portal?child=${c.id}`)}
        >
          {c.name}
        </Button>
      ))}
    </div>
  );
}
