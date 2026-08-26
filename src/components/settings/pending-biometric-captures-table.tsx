import Link from "next/link";

export interface PendingBiometricCaptureRow {
  id: string;
  full_name: string;
  admission_number: string;
  class_label: string | null;
}

export function PendingBiometricCapturesTable({ rows }: { rows: PendingBiometricCaptureRow[] }) {
  return (
    <div className="panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <p className="text-sm font-medium">Pending biometric captures</p>
        <p className="text-xs text-muted-foreground">{rows.length} student{rows.length === 1 ? "" : "s"} not yet captured</p>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Every enrolled student eligible for biometric capture has been captured.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead>
              <tr>
                <th className="text-left">Student</th>
                <th className="text-left">Admission number</th>
                <th className="text-left">Class</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.full_name}</td>
                  <td className="font-mono text-[0.75rem] text-muted-foreground">{r.admission_number}</td>
                  <td className="text-muted-foreground">{r.class_label ?? "—"}</td>
                  <td className="text-right">
                    <Link href={`/students/${r.id}`} className="text-[0.8125rem] font-medium text-primary hover:underline">
                      Capture
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Students who have an active biometric profile but no enrolled fingerprint or face credential yet. Capture from the
        student&apos;s own Biometric tab.
      </p>
    </div>
  );
}
