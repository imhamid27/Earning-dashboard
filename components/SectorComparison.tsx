"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";
import { formatPct } from "@/lib/format";

interface SectorRow {
  sector: string;
  revenue_yoy: number | null;
  profit_yoy: number | null;
  companies_reported: number;
}

// Horizontal bar chart comparing sectors by YoY revenue (default) or
// profit growth. Bars tinted teal for growth, red for contraction.
//
// Height scales with the number of sectors — a fixed 320px height was
// cramping 15+ sectors into bars ~8px tall that were barely visible on
// mobile. We now allocate ~36px per sector with a floor of 280px, so
// the chart stays readable at any dataset size on any viewport.
const ROW_HEIGHT = 36;
const MIN_HEIGHT = 280;

export default function SectorComparison({
  rows,
  metric = "revenue_yoy",
  height,
}: {
  rows: SectorRow[];
  metric?: "revenue_yoy" | "profit_yoy";
  /** Optional override. Leave undefined to auto-scale with row count. */
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

  const computedHeight = height ?? Math.max(MIN_HEIGHT, data.length * ROW_HEIGHT + 40);

  return (
    <div style={{ width: "100%", height: computedHeight }}>
      <ResponsiveContainer>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 28, left: 4, bottom: 8 }}
          barCategoryGap="22%"
        >
          <CartesianGrid stroke="#eee" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "#6B6B6B" }}
            tickFormatter={(v) => `${v.toFixed(0)}%`}
          />
          <YAxis
            type="category"
            dataKey="sector"
            // Wider label column + slightly smaller font so long sector
            // names like "Communication Services" fit on one line.
            width={130}
            tick={{ fontSize: 11, fill: "#111" }}
            tickLine={false}
            axisLine={{ stroke: "#e5e5e5" }}
            interval={0}
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
