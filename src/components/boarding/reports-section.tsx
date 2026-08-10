export interface DormUtilizationRow {
  house_name: string;
  dorm_name: string;
  capacity: number | null;
  occupied: number;
  beds: number;
}

export interface ReportsData {
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
  reservedBeds: number;
  unavailableBeds: number;
  activeAllocations: number;
  endedAllocationsThisTerm: number;
  transfersThisTerm: number;
  incidentsOpenClosed: { open: number; closed: number };
  dormUtilization: DormUtilizationRow[];
}

export function ReportsSection({ data }: { data: ReportsData }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-2 text-sm font-medium">Bed availability</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="panel p-3">
            <p className="label-eyebrow">Occupied</p>
            <p className="text-lg font-semibold">{data.occupiedBeds}</p>
          </div>
          <div className="panel p-3">
            <p className="label-eyebrow">Available</p>
            <p className="text-lg font-semibold">{data.availableBeds}</p>
          </div>
          <div className="panel p-3">
            <p className="label-eyebrow">Reserved</p>
            <p className="text-lg font-semibold">{data.reservedBeds}</p>
          </div>
          <div className="panel p-3">
            <p className="label-eyebrow">Unavailable</p>
            <p className="text-lg font-semibold">{data.unavailableBeds}</p>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Allocation &amp; movement</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="panel p-3">
            <p className="label-eyebrow">Active allocations</p>
            <p className="text-lg font-semibold">{data.activeAllocations}</p>
          </div>
          <div className="panel p-3">
            <p className="label-eyebrow">Transfers on record</p>
            <p className="text-lg font-semibold">{data.transfersThisTerm}</p>
          </div>
          <div className="panel p-3">
            <p className="label-eyebrow">Incidents (open / closed)</p>
            <p className="text-lg font-semibold">
              {data.incidentsOpenClosed.open} / {data.incidentsOpenClosed.closed}
            </p>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Dormitory utilization</p>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead>
              <tr>
                <th className="text-left">House</th>
                <th className="text-left">Dormitory</th>
                <th className="text-left">Beds</th>
                <th className="text-left">Occupied</th>
                <th className="text-left">Utilization</th>
              </tr>
            </thead>
            <tbody>
              {data.dormUtilization.map((d) => {
                const rate = d.beds > 0 ? Math.round((d.occupied / d.beds) * 100) : 0;
                return (
                  <tr key={`${d.house_name}-${d.dorm_name}`}>
                    <td>{d.house_name}</td>
                    <td>{d.dorm_name}</td>
                    <td>{d.beds}</td>
                    <td>{d.occupied}</td>
                    <td className={rate >= 90 ? "font-medium text-danger" : undefined}>{rate}%</td>
                  </tr>
                );
              })}
              {data.dormUtilization.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No dormitories yet.
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
