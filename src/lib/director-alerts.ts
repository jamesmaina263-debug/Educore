// WP 3.2 director alerts, dry-run. Pure helpers for the cron route.
// director_alerts_evaluate() returns the alerts it just recorded as 'would_send', WITH the figures and the
// director's phone so a later step can format and send them. This step never sends, and it never logs or
// returns the phone or the figures: only counts.

export type DirectorAlertRow = {
  log_id: string;
  school_id: string;
  school_user_id: string;
  phone: string;
  alert_type: string;
  payload: unknown;
};

export const DIRECTOR_ALERT_TYPES = ["large_payment", "collection_drop", "low_attendance"] as const;

export type DirectorAlertSummary = {
  total: number;
  schools: number;
  directors: number;
  by_type: Record<(typeof DIRECTOR_ALERT_TYPES)[number], number>;
};

export function summariseDirectorAlerts(rows: DirectorAlertRow[] | null | undefined): DirectorAlertSummary {
  const list = Array.isArray(rows) ? rows : [];
  const by_type = { large_payment: 0, collection_drop: 0, low_attendance: 0 };
  for (const r of list) {
    if ((DIRECTOR_ALERT_TYPES as readonly string[]).includes(r.alert_type)) {
      by_type[r.alert_type as keyof typeof by_type] += 1;
    }
  }
  return {
    total: list.length,
    schools: new Set(list.map((r) => r.school_id)).size,
    directors: new Set(list.map((r) => r.school_user_id)).size,
    by_type,
  };
}
