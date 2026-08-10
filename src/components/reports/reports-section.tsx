import { StatusBadge } from "@/components/status-badge";

export interface EnrollmentMonth {
  month: string;
  count: number;
}

export interface FeeForecast {
  term_name: string;
  total_invoiced: number;
  total_collected: number;
  current_collection_rate_pct: number | null;
  projected_collection_rate_pct: number | null;
}

export interface AtRiskRow {
  student_id: string;
  first_name: string;
  last_name: string;
  admission_number: string;
  attendance_rate_30d: number | null;
  latest_exam_average: number | null;
  overdue_balance: number | null;
  risk_score: number;
  risk_reasons: string[];
}

export interface AttendanceTrendDay {
  date: string;
  present: number;
  total: number;
}

export interface TransportRouteCapacityRow {
  route_id: string;
  route_name: string;
  capacity: number;
  allocated: number;
  available: number;
}

function Panel({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <header className="border-b border-border px-4 py-2.5">
        <h2 className="text-[0.8125rem] font-semibold">{title}</h2>
        <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{meta}</p>
      </header>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function EnrollmentTrendCard({ months }: { months: EnrollmentMonth[] }) {
  const max = Math.max(1, ...months.map((m) => m.count));
  return (
    <Panel title="Enrollment trend" meta="New admissions by month, last 6 months">
      {months.every((m) => m.count === 0) ? (
        <p className="text-sm text-muted-foreground">No admissions recorded in this window.</p>
      ) : (
        <div className="flex items-end gap-3 h-32">
          {months.map((m) => (
            <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-primary/70"
                style={{ height: `${Math.max(4, (m.count / max) * 100)}%` }}
              />
              <span className="text-xs tabular-nums text-muted-foreground">{m.count}</span>
              <span className="text-[10px] text-muted-foreground">{m.month}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function FeeCollectionCard({ forecast }: { forecast: FeeForecast | null }) {
  return (
    <Panel title="Fee collection" meta={forecast ? forecast.term_name : "No active term"}>
      {forecast ? (
        <div className="flex gap-6 text-sm">
          <div>
            <p className="label-eyebrow">Invoiced</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">KES {forecast.total_invoiced.toLocaleString()}</p>
          </div>
          <div>
            <p className="label-eyebrow">Collected</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">KES {forecast.total_collected.toLocaleString()}</p>
          </div>
          <div>
            <p className="label-eyebrow">Rate so far</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{forecast.current_collection_rate_pct ?? 0}%</p>
          </div>
          <div>
            <p className="label-eyebrow">Projected (linear)</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {Math.min(100, forecast.projected_collection_rate_pct ?? 0)}%
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No active term with fee data.</p>
      )}
    </Panel>
  );
}

export function AttendanceTrendCard({ days }: { days: AttendanceTrendDay[] }) {
  return (
    <Panel title="Attendance rate" meta="School-wide, last 7 days">
      {days.every((d) => d.total === 0) ? (
        <p className="text-sm text-muted-foreground">No attendance marked in this window.</p>
      ) : (
        <div className="flex items-end gap-3 h-24">
          {days.map((d) => {
            const rate = d.total > 0 ? Math.round((100 * d.present) / d.total) : 0;
            return (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-t bg-info/70" style={{ height: `${Math.max(4, rate)}%` }} />
                <span className="text-xs tabular-nums text-muted-foreground">{rate}%</span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function AtRiskTable({ rows }: { rows: AtRiskRow[] }) {
  return (
    <div className="panel">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <h2 className="text-[0.8125rem] font-semibold">At-risk students</h2>
          <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
            Rule-based flags: attendance &lt;75% (30d), latest exam average &lt;40, or a balance overdue &gt;30 days
          </p>
        </div>
        <span className="text-[0.6875rem] text-muted-foreground">
          {rows.length} student{rows.length === 1 ? "" : "s"}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="p-10 text-center text-sm text-muted-foreground">No students are currently flagged.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>Student</th>
                <th>Adm. No.</th>
                <th>Attendance (30d)</th>
                <th>Latest exam avg</th>
                <th>Overdue balance</th>
                <th>Reasons</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.student_id}>
                  <td className="font-medium">
                    {r.first_name} {r.last_name}
                  </td>
                  <td className="text-muted-foreground">{r.admission_number}</td>
                  <td>{r.attendance_rate_30d != null ? `${r.attendance_rate_30d}%` : "—"}</td>
                  <td>{r.latest_exam_average != null ? r.latest_exam_average : "—"}</td>
                  <td>{r.overdue_balance != null ? `KES ${Number(r.overdue_balance).toLocaleString()}` : "—"}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {r.risk_reasons.map((reason) => (
                        <StatusBadge key={reason} tone="warning" label={reason.replaceAll("_", " ")} />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function TransportCapacityCard({ routes }: { routes: TransportRouteCapacityRow[] }) {
  return (
    <Panel title="Transport capacity" meta="Live route allocation — read by Admissions when assigning transport">
      {routes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No routes configured yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>Route</th>
                <th>Capacity</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.route_id}>
                  <td className="font-medium">{r.route_name}</td>
                  <td>
                    {r.capacity > 0 ? (
                      <StatusBadge
                        tone={r.available <= 0 ? "warning" : "success"}
                        label={`${r.allocated}/${r.capacity} — ${r.available} free`}
                      />
                    ) : (
                      <StatusBadge tone="neutral" label="Not configured" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
