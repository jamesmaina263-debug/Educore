export interface EmploymentInput {
  position?: string | null;
  department?: string | null;
  hire_date?: string | null;
  contract_type?: "permanent" | "contract" | "part_time" | null;
  contract_end_date?: string | null;
  gender?: "male" | "female" | null;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Turns the Employment tab's form state into a safe `school_users` update payload.
 *
 * Two things the raw form state got wrong:
 *  - A cleared <input type="date"> yields "", which Postgres rejects for a date column
 *    ("invalid input syntax for type date"). Clearing the contract end date when someone moves
 *    from a fixed-term to a permanent contract is the most natural edit there is, and it always
 *    failed. Blank strings are now stored as NULL (and text fields are trimmed).
 *  - The whole object was passed straight to .update(), so a crafted call could have written any
 *    column the caller's RLS allowed. Only the six employment fields are ever forwarded.
 *
 * Fields that are absent (undefined) are left out entirely so they stay untouched.
 */
export function buildEmploymentUpdate(input: EmploymentInput): { error: string } | { payload: Record<string, string | null> } {
  const payload: Record<string, string | null> = {};

  if (input.position !== undefined) payload.position = blankToNull(input.position);
  if (input.department !== undefined) payload.department = blankToNull(input.department);
  if (input.hire_date !== undefined) payload.hire_date = blankToNull(input.hire_date);
  if (input.contract_end_date !== undefined) payload.contract_end_date = blankToNull(input.contract_end_date);
  if (input.contract_type !== undefined) payload.contract_type = input.contract_type ?? null;
  if (input.gender !== undefined) payload.gender = input.gender ?? null;

  if (payload.hire_date && payload.contract_end_date && payload.contract_end_date < payload.hire_date) {
    return { error: "The contract end date can't be before the hire date." };
  }

  return { payload };
}
