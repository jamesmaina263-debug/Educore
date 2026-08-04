import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

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

export function EnrollmentTrendCard({ months }: { months: EnrollmentMonth[] }) {
  const max = Math.max(1, ...months.map((m) => m.count));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enrollment trend</CardTitle>
        <CardDescription>New admissions by month, last 6 months</CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

export function FeeCollectionCard({ forecast }: { forecast: FeeForecast | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fee collection</CardTitle>
        <CardDescription>{forecast ? forecast.term_name : "No active term"}</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-6 text-sm">
        {forecast ? (
          <>
            <div>
              <div className="text-xs text-muted-foreground">Invoiced</div>
              <div className="text-lg font-semibold tabular-nums">
                KES {forecast.total_invoiced.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Collected</div>
              <div className="text-lg font-semibold tabular-nums">
                KES {forecast.total_collected.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Rate so far</div>
              <div className="text-lg font-semibold tabular-nums">
                {forecast.current_collection_rate_pct ?? 0}%
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Projected (linear)</div>
              <div className="text-lg font-semibold tabular-nums">
                {Math.min(100, forecast.projected_collection_rate_pct ?? 0)}%
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No active term with fee data.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function AttendanceTrendCard({ days }: { days: AttendanceTrendDay[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance rate</CardTitle>
        <CardDescription>School-wide, last 7 days</CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

export function AtRiskTable({ rows }: { rows: AtRiskRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>At-risk students</CardTitle>
        <CardDescription>
          Rule-based flags: attendance &lt;75% (30d), latest exam average &lt;40, or a balance overdue
          &gt;30 days
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No students are currently flagged.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Adm. No.</TableHead>
                <TableHead>Attendance (30d)</TableHead>
                <TableHead>Latest exam avg</TableHead>
                <TableHead>Overdue balance</TableHead>
                <TableHead>Reasons</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.student_id}>
                  <TableCell>
                    {r.first_name} {r.last_name}
                  </TableCell>
                  <TableCell>{r.admission_number}</TableCell>
                  <TableCell>{r.attendance_rate_30d != null ? `${r.attendance_rate_30d}%` : "—"}</TableCell>
                  <TableCell>{r.latest_exam_average != null ? r.latest_exam_average : "—"}</TableCell>
                  <TableCell>
                    {r.overdue_balance != null ? `KES ${Number(r.overdue_balance).toLocaleString()}` : "—"}
                  </TableCell>
                  <TableCell className="flex flex-wrap gap-1">
                    {r.risk_reasons.map((reason) => (
                      <Badge key={reason} variant="warning">
                        {reason.replaceAll("_", " ")}
                      </Badge>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
