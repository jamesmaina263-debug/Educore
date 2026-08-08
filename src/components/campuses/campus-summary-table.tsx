import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";

export interface CampusSummaryRow {
  school_id: string;
  school_name: string;
  active_students: number;
  fee_collection_rate: number;
  attendance_rate_today: number;
}

export function CampusSummaryTable({ rows }: { rows: CampusSummaryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No campuses in this group yet.</p>;
  }

  return (
    <div className="panel">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Campus</TableHead>
            <TableHead>Active students</TableHead>
            <TableHead>Fee collection rate</TableHead>
            <TableHead>Attendance today</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.school_id}>
              <TableCell className="font-medium">{row.school_name}</TableCell>
              <TableCell>{row.active_students}</TableCell>
              <TableCell>{row.fee_collection_rate}%</TableCell>
              <TableCell>{row.attendance_rate_today}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="border-t border-border p-3 text-xs text-muted-foreground">
        Read-only cross-campus visibility. Per-student and per-staff detail still lives inside
        each campus&apos;s own account — this is deliberately a rollup, not a way to reach into a
        campus&apos;s day-to-day records (Phase 5 scope decision).
      </p>
    </div>
  );
}
