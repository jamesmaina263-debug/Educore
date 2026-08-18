export interface MedicalRecordListRow {
  student_id: string;
  student_name: string;
  has_record: boolean;
  has_conditions_or_allergies: boolean;
  restricted: boolean;
}

export function MedicalRecordsSection({ rows }: { rows: MedicalRecordListRow[] }) {
  const restricted = rows.length > 0 && rows[0].restricted;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Each student&apos;s medical profile (allergies, conditions, blood group, emergency contact) lives on their Student
        profile under the Medical tab, with strict role-based access and an access log. Click through to view or update it.
      </p>
      {restricted && (
        <p className="text-sm text-danger">
          Your role can see this student list but not their medical alert flags. A blank Alerts column here does not
          mean a student has no known conditions or allergies -- ask someone with medical-record access to check.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead>
            <tr>
              <th className="text-left">Student</th>
              <th className="text-left">Profile on file</th>
              <th className="text-left">Alerts</th>
              <th className="text-left"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.student_id}>
                <td>{r.student_name}</td>
                <td>{r.restricted ? "Restricted" : r.has_record ? "Yes" : "Not yet recorded"}</td>
                <td className="text-danger">{r.restricted ? "Restricted" : r.has_conditions_or_allergies ? "Conditions/allergies on file" : ""}</td>
                <td>
                  <a href={`/students/${r.student_id}`} className="text-sm underline">
                    View profile
                  </a>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted-foreground">
                  No active students.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
