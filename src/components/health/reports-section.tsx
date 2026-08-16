import { TableExportMenu } from "@/components/shared/table-export-menu";

export interface HealthReportsData {
  totalVisitsThisTerm: number;
  commonReasons: { reason: string; count: number }[];
  medicationsThisTerm: number;
  referralsThisTerm: number;
  emergenciesThisTerm: number;
  sickBayUtilizationRate: number; // % of school days with at least one visit, or similar simple metric
}

export function ReportsSection({ data, schoolName }: { data: HealthReportsData; schoolName: string }) {
  const summaryRows = [
    {
      "Clinic Visits": data.totalVisitsThisTerm,
      "Medications Given": data.medicationsThisTerm,
      Referrals: data.referralsThisTerm,
      Emergencies: data.emergenciesThisTerm,
      "Sick Bay Utilization (%)": data.sickBayUtilizationRate,
    },
  ];
  const reasonRows = data.commonReasons.map((r) => ({ Reason: r.reason, Visits: r.count }));

  return (
    <div className="flex flex-col gap-6">
      <div className="mb-1 flex items-center justify-end">
        <TableExportMenu
          filenameStub={`${schoolName}-health-summary`}
          title="Health Summary"
          subtitle={schoolName}
          rows={summaryRows}
        />
      </div>
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
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm font-medium">Most common visit reasons</p>
          <TableExportMenu
            filenameStub={`${schoolName}-visit-reasons`}
            title="Visit Reasons"
            subtitle={schoolName}
            rows={reasonRows}
          />
        </div>
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
