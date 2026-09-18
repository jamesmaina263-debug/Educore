"use client";

import * as React from "react";
import { ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/**
 * Minimal shape every module's student option already has (or can trivially add).
 * class_name/admission_number are optional so this drops into existing call sites
 * (e.g. finance's StudentOption) without forcing an immediate data-shape change --
 * search/grouping just degrade gracefully to name-only until callers pass more.
 */
export interface StudentComboboxOption {
  id: string;
  name: string;
  admission_number?: string;
  class_name?: string;
}

/**
 * Searchable replacement for a plain <Select> full of every student in the school.
 * Opens a command-palette-style dialog (search box + list) instead of a native
 * dropdown, so it stays usable at 1,000+ students: search matches name OR admission
 * number, and results group by class when class_name is available. This is a
 * client-side filter over whatever `students` array the caller already fetched --
 * it does not change how much data is loaded. For screens that currently fetch
 * every active student just to populate a picker, pairing this with a paginated/
 * searched server query (getStudentList) is the next step; this component's API
 * already fits that swap since it only needs id/name/admission_number/class_name.
 */
export function StudentCombobox({
  students,
  value,
  onChange,
  placeholder = "Select a student",
  disabled,
}: {
  students: StudentComboboxOption[];
  value: string;
  onChange: (studentId: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = students.find((s) => s.id === value);

  const groups = React.useMemo(() => {
    const byClass = new Map<string, StudentComboboxOption[]>();
    for (const s of students) {
      const key = s.class_name || "Unassigned";
      if (!byClass.has(key)) byClass.set(key, []);
      byClass.get(key)!.push(s);
    }
    return Array.from(byClass.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [students]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        className="w-full justify-between font-normal"
        onClick={() => setOpen(true)}
      >
        <span className={cn(!selected && "text-muted-foreground")}>
          {selected
            ? `${selected.name}${selected.admission_number ? ` (${selected.admission_number})` : ""}`
            : placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search by name or admission number..." />
        <CommandList>
          <CommandEmpty>No student found.</CommandEmpty>
          {groups.map(([className, groupStudents]) => (
            <CommandGroup key={className} heading={className}>
              {groupStudents.map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.id}
                  keywords={[s.name, s.admission_number ?? ""].filter(Boolean)}
                  onSelect={() => {
                    onChange(s.id);
                    setOpen(false);
                  }}
                >
                  {s.name}
                  {s.admission_number && (
                    <span className="ml-2 text-xs text-muted-foreground">{s.admission_number}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
