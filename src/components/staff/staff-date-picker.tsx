"use client";

import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { useSchoolHref } from "@/components/app-shell/school-slug-context";

export function StaffDatePicker({ date }: { date: string }) {
  const router = useRouter();
  const toHref = useSchoolHref();

  return (
    <Input
      type="date"
      defaultValue={date}
      className="w-40"
      onChange={(e) => router.push(toHref(`/staff?date=${e.target.value}`))}
    />
  );
}
