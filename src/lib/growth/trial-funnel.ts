// Parsing and row-building for admin_trial_funnel (20261019140000_admin_trial_funnel.sql), the "Trial funnel"
// panel on /admin/analytics. The database computes every number; this validates the JSON (so a changed or
// partial response can never throw or show NaN) and turns it into display rows. Pure and unit-tested.

export type TrialFunnel = {
  from: string;
  to: string;
  siteVisitors: number;
  signupVisitors: number;
  trialsStarted: number;
  activation: {
    cohortSchools: number;
    withStudents: number;
    withFeeStructure: number;
    withInvoice: number;
    withSecondUser: number;
    setUpBasics: number;
  };
};

export type TrialFunnelRow = {
  label: string;
  value: number;
  /** Share of the previous row, e.g. "20.0%". Null when the previous row is 0 or this is the first row. */
  ofPrevious: string | null;
  note?: string;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Null only when the response is not an object at all; missing sections become zeros. */
export function parseTrialFunnel(raw: unknown): TrialFunnel | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const a = obj(r.activation);
  return {
    from: typeof r.from === "string" ? r.from : "",
    to: typeof r.to === "string" ? r.to : "",
    siteVisitors: num(r.site_visitors),
    signupVisitors: num(r.signup_visitors),
    trialsStarted: num(r.trials_started),
    activation: {
      cohortSchools: num(a.cohort_schools),
      withStudents: num(a.with_students),
      withFeeStructure: num(a.with_fee_structure),
      withInvoice: num(a.with_invoice),
      withSecondUser: num(a.with_second_user),
      setUpBasics: num(a.set_up_basics),
    },
  };
}

function pct(n: number, d: number): string | null {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : null;
}

/**
 * Visits -> /signup -> trials, then what the (non-demo) trial schools have set up. Setup rows are shares of
 * the activation cohort, not of the previous row, because they overlap rather than nest.
 */
export function funnelRows(f: TrialFunnel): { journey: TrialFunnelRow[]; setup: TrialFunnelRow[] } {
  const a = f.activation;
  return {
    journey: [
      { label: "Website visitors", value: f.siteVisitors, ofPrevious: null, note: "Distinct visitors per day, added up over the range" },
      { label: "Opened /signup", value: f.signupVisitors, ofPrevious: pct(f.signupVisitors, f.siteVisitors) },
      { label: "Trials started", value: f.trialsStarted, ofPrevious: pct(f.trialsStarted, f.signupVisitors), note: "Includes any internal test or demo schools" },
    ],
    setup: [
      { label: "Added students", value: a.withStudents, ofPrevious: pct(a.withStudents, a.cohortSchools) },
      { label: "Created a fee structure", value: a.withFeeStructure, ofPrevious: pct(a.withFeeStructure, a.cohortSchools) },
      { label: "Issued an invoice", value: a.withInvoice, ofPrevious: pct(a.withInvoice, a.cohortSchools) },
      { label: "Added a second user", value: a.withSecondUser, ofPrevious: pct(a.withSecondUser, a.cohortSchools) },
      { label: "Students, fees and invoices all done", value: a.setUpBasics, ofPrevious: pct(a.setUpBasics, a.cohortSchools) },
    ],
  };
}
