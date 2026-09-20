"use client";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export type LeadRow = {
  id: string;
  created_at: string;
  email: string;
  resource: string;
  source_page: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
};

// Deliberately no status/assignment workflow here, unlike
// AdminDemoRequestsTable -- this is a read-only list for a low-intent
// signal (an email address, not a demo request). CSV export is client-side
// (no server round-trip, no new endpoint) since 500 rows is small enough
// to build a CSV string from what's already fetched.
function toCsv(rows: LeadRow[]): string {
  const header = ["Email", "Resource", "Source page", "UTM source", "UTM medium", "UTM campaign", "Captured at"];
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = rows.map((row) =>
    [
      row.email,
      row.resource,
      row.source_page ?? "",
      row.utm_source ?? "",
      row.utm_medium ?? "",
      row.utm_campaign ?? "",
      new Date(row.created_at).toISOString(),
    ]
      .map(escape)
      .join(","),
  );
  return [header.map(escape).join(","), ...lines].join("\n");
}

function downloadCsv(rows: LeadRow[]) {
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `educore-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AdminLeadsTable({ rows }: { rows: LeadRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {rows.length} captured {rows.length === 1 ? "lead" : "leads"}
        </p>
        <Button size="sm" variant="outline" onClick={() => downloadCsv(rows)} disabled={rows.length === 0}>
          Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>Source page</TableHead>
              <TableHead>UTM source</TableHead>
              <TableHead>UTM campaign</TableHead>
              <TableHead>Captured</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  No leads captured yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.email}</TableCell>
                  <TableCell>{row.resource}</TableCell>
                  <TableCell className="text-muted-foreground">{row.source_page ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{row.utm_source ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{row.utm_campaign ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
