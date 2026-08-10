export interface HealthReportsData {
  totalVisitsThisTerm: number;
  commonReasons: { reason: string; count: number }[];
  medicationsThisTerm: number;
  referralsThisTerm: number;
  emergenciesThisTerm: number;
  sickBayUtilizationRate: number; // % of school days with at least one visit, or similar simple metric
}

export function ReportsSection({ data }: { data: HealthReportsData }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="panel p-3">
          <p className="label-eyebrow">Clinic visits</p>
          <p className="text-lg font-semibold">{data.totalVisitsThisTerm}</p>
        </div>
        <div className="panel p-3">
          <p className="label-eyebrow">Medications given</p>
          <p className="text-lg font-semibold">{data.medicationsThisTerm}</p>
        </div>
        <div className="panel p-3">
          <p className="label-eyebrow">Referrals</p>
          <p className="text-lg font-semibold">{data.referralsThisTerm}</p>
        </div>
        <div className="panel p-3">
          <p className="label-eyebrow">Emergencies</p>
          <p className="text-lg font-semibold">{data.emergenciesThisTerm}</p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Most common visit reasons</p>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead>
              <tr>
                <th className="text-left">Reason</th>
                <th className="text-left">Visits</th>
              </tr>
            </thead>
            <tbody>
              {data.commonReasons.map((r) => (
                <tr key={r.reason}>
                  <td>{r.reason}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
              {data.commonReasons.length === 0 && (
                <tr>
                  <td colSpan={2} className="py-6 text-center text-muted-foreground">
                    No visits recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
