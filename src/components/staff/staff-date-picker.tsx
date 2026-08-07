"use client";

import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

export function StaffDatePicker({ date }: { date: string }) {
  const router = useRouter();

  return (
    <Input
      type="date"
      defaultValue={date}
      className="w-40"
      onChange={(e) => router.push(`/staff?date=${e.target.value}`)}
    />
  );
}
