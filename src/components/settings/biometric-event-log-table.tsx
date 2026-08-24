"use client";

import { useMemo, useState } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export interface BiometricEventLogRow {
  id: string;
  occurred_at: string;
  person_name: string | null;
  person_type: "student" | "staff" | null;
  device_name: string | null;
  result: "success" | "failed" | "unknown_credential" | "revoked_credential" | "inactive_profile" | "device_inactive";
  event_type: "check_in" | "check_out" | null;
}

const RESULT_TONE: Record<string, string> = {
  success: "text-success",
  failed: "text-danger",
  unknown_credential: "text-danger",
  revoked_credential: "text-danger",
  inactive_profile: "text-danger",
  device_inactive: "text-danger",
};

const RESULT_LABEL: Record<string, string> = {
  success: "Success",
  failed: "Failed",
  unknown_credential: "Unknown credential",
  revoked_credential: "Revoked credential",
  inactive_profile: "Inactive profile",
  device_inactive: "Device inactive",
};

export function BiometricEventLogTable({ rows }: { rows: BiometricEventLogRow[] }) {
  const [resultFilter, setResultFilter] = useState("all");
  const results = useMemo(() => Array.from(new Set(rows.map((r) => r.result))).sort(), [rows]);
  const filtered = resultFilter === "all" ? rows : rows.filter((r) => r.result === resultFilter);

  return (
    <div className="panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <p className="text-sm font-medium">Biometric verification log</p>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {filtered.length} of {rows.length} recent attempts
          </p>
          <Select value={resultFilter} onValueChange={setResultFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All results</SelectItem>
              {results.map((r) => (
                <SelectItem key={r} value={r}>
                  {RESULT_LABEL[r] ?? r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>
      {filtered.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No verification attempts match this filter yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead>
              <tr>
                <th className="text-left">When</th>
                <th className="text-left">Person</th>
                <th className="text-left">Device</th>
                <th className="text-left">Result</th>
                <th className="text-left">Direction</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.occurred_at).toLocaleString()}</td>
                  <td>
                    {r.person_name ?? "Unknown"}
                    {r.person_type && <span className="text-muted-foreground"> ({r.person_type})</span>}
                  </td>
                  <td>{r.device_name ?? "—"}</td>
                  <td className={RESULT_TONE[r.result] ?? ""}>{RESULT_LABEL[r.result] ?? r.result}</td>
                  <td className="text-muted-foreground">{r.event_type ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Every verification attempt a device reported, success or failure. Never shows or stores a fingerprint, face image, raw
        template, or embedding -- only which of the device&apos;s own opaque reference IDs matched and the outcome.
      </p>
    </div>
  );
}
