"use client";

import { useState, useTransition } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  setNotificationPreference,
  type PrefCategory,
  type PrefChannel,
  type PreferenceRow,
} from "@/app/notifications/actions";

const CATEGORIES: { value: PrefCategory; label: string }[] = [
  { value: "fee_reminder", label: "Fee reminders" },
  { value: "absence_alert", label: "Absence alerts" },
  { value: "result_published", label: "Result publications" },
  { value: "announcement", label: "General announcements" },
  { value: "other", label: "Other" },
];

const CHANNELS: { value: PrefChannel; label: string }[] = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
];

// Opt-out model: anything not present in `initialRows` is enabled by default, mirroring the DB's
// notification_allowed() helper — a row only exists once someone actually turns something off.
export function NotificationPreferencesPanel({ initialRows }: { initialRows: PreferenceRow[] }) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const r of initialRows) map[`${r.category}:${r.channel}`] = r.enabled;
    return map;
  });
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function isEnabled(category: PrefCategory, channel: PrefChannel) {
    const key = `${category}:${channel}`;
    return key in overrides ? overrides[key] : true;
  }

  function toggle(category: PrefCategory, channel: PrefChannel) {
    const key = `${category}:${channel}`;
    const next = !isEnabled(category, channel);
    setOverrides((prev) => ({ ...prev, [key]: next }));
    setPendingKey(key);
    setError(null);
    startTransition(async () => {
      const res = await setNotificationPreference(category, channel, next);
      setPendingKey(null);
      if ("error" in res) {
        // revert on failure
        setOverrides((prev) => ({ ...prev, [key]: !next }));
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Choose which messages reach you and on which channel. Unchecking a box turns that message off
        for you only — the school still sees it in their records.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-3 py-2 text-left font-medium">Message type</th>
              {CHANNELS.map((c) => (
                <th key={c.value} className="px-3 py-2 text-center font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((cat) => (
              <tr key={cat.value} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{cat.label}</td>
                {CHANNELS.map((ch) => {
                  const key = `${cat.value}:${ch.value}`;
                  return (
                    <td key={ch.value} className="px-3 py-2 text-center">
                      <Checkbox
                        checked={isEnabled(cat.value, ch.value)}
                        disabled={pendingKey === key}
                        onCheckedChange={() => toggle(cat.value, ch.value)}
                        aria-label={`${cat.label} via ${ch.label}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
