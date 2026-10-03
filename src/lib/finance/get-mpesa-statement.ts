import { createClient } from "@/lib/supabase/server";

/** One line of the M-Pesa payments statement, already flattened for display/export. */
export interface MpesaStatementRow {
  /** Date/time the payment was recorded in EduCore (Africa/Nairobi), "YYYY-MM-DD HH:mm". */
  date: string;
  mpesaCode: string;
  studentName: string;
  admissionNumber: string;
  className: string;
  phone: string;
  amount: number;
  status: "confirmed" | "recorded" | "reversed" | "unallocated";
}

export interface MpesaStatementResult {
  rows: MpesaStatementRow[];
  /** Sum of rows that are not reversed. */
  totalAmount: number;
  reversedCount: number;
  unallocatedCount: number;
}

const BATCH_SIZE = 1000; // PostgREST's default max rows per request.
const MAX_ROWS = 20000; // Safety ceiling so one export can never run away.
const MAX_RANGE_DAYS = 400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const nairobiFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Nairobi",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatNairobi(iso: string): string {
  const parts = Object.fromEntries(nairobiFormatter.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/**
 * Read-only: every M-Pesa payment the school has recorded between two calendar dates
 * (inclusive, Africa/Nairobi), with the M-Pesa receipt code and the student it was applied to.
 *
 * - Pending payments (an STK push that was never completed) are excluded: no money moved.
 * - Reversed payments are included and flagged, so the statement never silently hides a line.
 * - Unallocated payments are included with a blank student, since none has been assigned yet.
 *
 * Runs through the caller's own Supabase session, so the existing payments/students RLS
 * (finance.read, school-scoped) applies unchanged.
 */
export async function getMpesaStatement(
  fromDate: string,
  toDate: string,
): Promise<{ error: string } | ({ success: true } & MpesaStatementResult)> {
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) return { error: "Choose a valid start and end date." };
  const fromMs = Date.parse(`${fromDate}T00:00:00+03:00`);
  const toMs = Date.parse(`${toDate}T23:59:59.999+03:00`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return { error: "Choose a valid start and end date." };
  if (toMs < fromMs) return { error: "The end date must be on or after the start date." };
  if ((toMs - fromMs) / 86_400_000 > MAX_RANGE_DAYS) {
    return { error: `Choose a range of ${MAX_RANGE_DAYS} days or less.` };
  }

  const supabase = await createClient();

  const { data: canRead, error: permError } = await supabase.rpc("auth_has_permission", {
    p_permission_key: "finance.read",
  });
  if (permError) return { error: "Could not check your permissions. Please try again." };
  if (canRead !== true) return { error: "You don't have access to Finance." };

  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();

  const payments: {
    id: string;
    student_id: string | null;
    amount: number | string;
    reference: string | null;
    phone_number: string | null;
    status: string;
    recorded_at: string;
  }[] = [];

  for (let offset = 0; offset < MAX_ROWS; offset += BATCH_SIZE) {
    const { data, error } = await supabase
      .from("payments")
      .select("id, student_id, amount, reference, phone_number, status, recorded_at")
      .eq("method", "mpesa")
      .in("status", ["confirmed", "recorded", "reversed", "unallocated"])
      .gte("recorded_at", fromIso)
      .lte("recorded_at", toIso)
      // id as a tiebreaker keeps paging stable when several payments share a timestamp.
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) return { error: "Could not load payments. Please try again." };
    payments.push(...(data ?? []));
    if (!data || data.length < BATCH_SIZE) break;
    if (offset + BATCH_SIZE >= MAX_ROWS) {
      return { error: "That range has too many payments to export at once. Please choose a shorter range." };
    }
  }

  const studentIds = Array.from(new Set(payments.map((p) => p.student_id).filter((id): id is string => !!id)));
  const studentById = new Map<
    string,
    { name: string; admission: string; streamId: string | null }
  >();

  // .in() lists go in chunks so the request URL never grows past PostgREST's limits.
  for (let i = 0; i < studentIds.length; i += 200) {
    const chunk = studentIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("students")
      .select("id, first_name, last_name, admission_number, current_class_id")
      .in("id", chunk);
    if (error) return { error: "Could not load student details. Please try again." };
    for (const s of data ?? []) {
      studentById.set(s.id, {
        name: `${s.first_name} ${s.last_name}`.trim(),
        admission: s.admission_number ?? "",
        streamId: s.current_class_id ?? null,
      });
    }
  }

  const classNameByStream = new Map<string, string>();
  if (studentById.size > 0) {
    const { data, error } = await supabase.from("streams").select("id, classes(name)");
    if (error) return { error: "Could not load class details. Please try again." };
    for (const s of data ?? []) {
      classNameByStream.set(s.id, (s.classes as unknown as { name: string } | null)?.name ?? "");
    }
  }

  let totalAmount = 0;
  let reversedCount = 0;
  let unallocatedCount = 0;

  const rows: MpesaStatementRow[] = payments.map((p) => {
    const st = p.student_id ? studentById.get(p.student_id) : undefined;
    const amount = Number(p.amount);
    if (p.status === "reversed") reversedCount += 1;
    else totalAmount += amount;
    if (p.status === "unallocated") unallocatedCount += 1;
    return {
      date: formatNairobi(p.recorded_at),
      mpesaCode: (p.reference ?? "").trim(),
      studentName: st?.name ?? "",
      admissionNumber: st?.admission ?? "",
      className: st?.streamId ? classNameByStream.get(st.streamId) ?? "" : "",
      phone: p.phone_number ?? "",
      amount,
      status: p.status as MpesaStatementRow["status"],
    };
  });

  return { success: true, rows, totalAmount: Math.round(totalAmount * 100) / 100, reversedCount, unallocatedCount };
}
