"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";
import { formatPct } from "@/lib/format";

interface SectorRow {
  sector: string;
  revenue_yoy: number | null;
  profit_yoy: number | null;
  companies_reported: number;
}

// Horizontal bar chart comparing sectors by YoY revenue (default) or profit
// growth. Bars tinted red for negative, black for positive — The Core palette.
export default function SectorComparison({
  rows,
  metric = "revenue_yoy",
  height = 320
}: {
  rows: SectorRow[];
  metric?: "revenue_yoy" | "profit_yoy";
  height?: number;
}) {
  const data = rows
    .filter((r) => r[metric] != null)
    .map((r) => ({ sector: r.sector, value: (r[metric] ?? 0) * 100, count: r.companies_reported }))
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) {
    return (
      <div className="text-sm text-core-muted p-6 text-center">
        Not enough sector data to compare yet.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="#eee" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: "#6B6B6B" }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
          <YAxis
            type="category"
            dataKey="sector"
            width={150}
            tick={{ fontSize: 12, fill: "#111" }}
            tickLine={false}
            axisLine={{ stroke: "#e5e5e5" }}
          />
          <Tooltip
            contentStyle={{ borderRadius: 2, border: "1px solid #e5e5e5", fontSize: 12 }}
            formatter={(v: any, _n, p: any) => [formatPct(Number(v) / 100), `${p.payload.count} cos`]}
          />
          <Bar dataKey="value" radius={[0, 2, 2, 0]}>
            {data.map((d, i) => (
              // Brand palette: teal for growth, red for contraction.
              <Cell key={i} fill={d.value >= 0 ? "#17AB8C" : "#DC2626"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
