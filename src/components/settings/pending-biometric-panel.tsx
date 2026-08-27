import Link from "next/link";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

export interface PendingBiometricRow {
  id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  class_name: string | null;
}

// Task 12: read-only visibility into students who are biometric-eligible (enrolled, with an
// active biometric_profiles row auto-created by the existing trigger) but have never actually
// had a fingerprint/face captured on a device (no active biometric_credentials row). Nothing
// here can enroll or revoke a credential -- that still only happens on the kiosk/device flow.
export function PendingBiometricPanel({ rows }: { rows: PendingBiometricRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="label-eyebrow">
          {rows.length} student{rows.length === 1 ? "" : "s"} pending capture
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Enrolled students who are eligible for biometrics but have not yet had a fingerprint or face captured on a
          device.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody is currently pending capture.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Admission No.</TableHead>
              <TableHead>Class</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/students/${r.id}`} className="underline">
                    {r.first_name} {r.last_name}
                  </Link>
                </TableCell>
                <TableCell>{r.admission_number}</TableCell>
                <TableCell>{r.class_name ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
