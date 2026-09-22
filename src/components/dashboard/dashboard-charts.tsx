"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Label,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const tooltipStyle = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontSize: "12px",
  color: "var(--popover-foreground)",
} as const;

export function CollectionTrendChart({
  data,
}: {
  data: { week: string; invoiced: number; collected: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
        <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
        <Legend
          verticalAlign="top"
          align="left"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: "12px", color: "var(--muted-foreground)" }}
        />
        <Bar dataKey="collected" name="Collected" fill="var(--chart-1)" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          <LabelList dataKey="collected" position="top" fontSize={11} fill="var(--foreground)" />
        </Bar>
        <Bar dataKey="invoiced" name="Invoiced" fill="var(--chart-5)" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          <LabelList dataKey="invoiced" position="top" fontSize={11} fill="var(--foreground)" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AttendanceByClassChart({
  data,
}: {
  data: { classroom: string; rate: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="classroom" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
        <Bar dataKey="rate" fill="var(--chart-1)" radius={[2, 2, 0, 0]} barSize={26} isAnimationActive={false}>
          <LabelList dataKey="rate" position="top" fontSize={11} fill="var(--foreground)" formatter={(v: number) => `${v}%`} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function EnrollmentTrendChart({
  data,
}: {
  data: { term: string; students: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="term" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
        <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
        <Tooltip contentStyle={tooltipStyle} />
        <Line type="monotone" dataKey="students" stroke="var(--chart-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
