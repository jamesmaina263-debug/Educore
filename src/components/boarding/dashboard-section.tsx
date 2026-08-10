export interface DashboardStats {
  totalBoardingStudents: number;
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
  rollCallAbsenteesToday: number;
  sickBayCountToday: number;
  openIncidents: number;
  capacityAlerts: { label: string; occupied: number; capacity: number }[];
}

export function DashboardSection({ stats }: { stats: DashboardStats }) {
  const occupancyRate = stats.totalBeds > 0 ? Math.round((stats.occupiedBeds / stats.totalBeds) * 100) : 0;

  const cards = [
    { label: "Boarding students", value: stats.totalBoardingStudents },
    { label: "Occupancy", value: `${occupancyRate}%`, sub: `${stats.occupiedBeds}/${stats.totalBeds} beds` },
    { label: "Available beds", value: stats.availableBeds },
    { label: "Roll-call absentees (today)", value: stats.rollCallAbsenteesToday },
    { label: "In sick bay (today)", value: stats.sickBayCountToday },
    { label: "Open incidents", value: stats.openIncidents, danger: stats.openIncidents > 0 },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="panel p-4">
            <p className="label-eyebrow">{c.label}</p>
            <p className={`mt-1 text-xl font-semibold ${c.danger ? "text-danger" : ""}`}>{c.value}</p>
            {"sub" in c && c.sub && <p className="text-xs text-muted-foreground">{c.sub}</p>}
          </div>
        ))}
      </div>

      {stats.capacityAlerts.length > 0 && (
        <div className="panel p-4">
          <p className="mb-2 text-sm font-medium">Capacity alerts</p>
          <ul className="flex flex-col gap-1 text-sm">
            {stats.capacityAlerts.map((a) => (
              <li key={a.label} className="flex items-center justify-between">
                <span>{a.label}</span>
                <span className="font-medium text-danger">
                  {a.occupied}/{a.capacity}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
