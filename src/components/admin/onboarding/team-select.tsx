"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// The admin console is a shared login, so every change must name the team member making it (same convention as the
// trial messages page). The server action rejects anything that is not a real team member id.

export type Team = { id: string; name: string }[];
export const NO_ONE = "none";

export function TeamSelect({ team, value, onChange }: { team: Team; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">You are</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[12rem] text-[0.8125rem]" aria-label="Who you are">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_ONE}>Pick your name</SelectItem>
          {team.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
