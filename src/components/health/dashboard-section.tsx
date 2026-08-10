export interface HealthDashboardStats {
  visitsToday: number;
  inSickBayNow: number;
  emergenciesThisWeek: number;
  pendingReferrals: number;
  medicationsToday: number;
  lowStockItems: number;
  expiringSoonItems: number;
  recentActivity: { label: string; time: string }[];
}

export function DashboardSection({ stats }: { stats: HealthDashboardStats }) {
  const cards = [
    { label: "Clinic visits today", value: stats.visitsToday },
    { label: "In sick bay now", value: stats.inSickBayNow, danger: stats.inSickBayNow > 0 },
    { label: "Pending referrals", value: stats.pendingReferrals },
    { label: "Emergencies (7d)", value: stats.emergenciesThisWeek, danger: stats.emergenciesThisWeek > 0 },
    { label: "Medications given today", value: stats.medicationsToday },
    { label: "Low stock / expiring", value: stats.lowStockItems + stats.expiringSoonItems, danger: stats.lowStockItems + stats.expiringSoonItems > 0 },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="panel p-4">
            <p className="label-eyebrow">{c.label}</p>
            <p className={`mt-1 text-xl font-semibold ${c.danger ? "text-danger" : ""}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {stats.recentActivity.length > 0 && (
        <div className="panel p-4">
          <p className="mb-2 text-sm font-medium">Recent activity</p>
          <ul className="flex flex-col gap-1 text-sm">
            {stats.recentActivity.map((a, i) => (
              <li key={i} className="flex items-center justify-between">
                <span>{a.label}</span>
                <span className="text-xs text-muted-foreground">{a.time}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
