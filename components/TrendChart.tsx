"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { formatINR } from "@/lib/format";

interface Row {
  quarter_label: string;
  revenue: number | null;
  net_profit: number | null;
}

// Dual-metric quarterly trend used on the company detail page and on the
// overall dashboard. Accepts either a "revenue" or "profit" focus.
export default function TrendChart({
  rows,
  metric,
  height = 280
}: {
  rows: Row[];
  metric: "revenue" | "net_profit";
  height?: number;
}) {
  // Brand palette: black for revenue (neutral series), teal for profit (positive).
  const stroke = metric === "revenue" ? "#0A0A0A" : "#17AB8C";
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="#eee" vertical={false} />
          <XAxis dataKey="quarter_label" tick={{ fontSize: 11, fill: "#6B6B6B" }} tickLine={false} axisLine={{ stroke: "#e5e5e5" }} />
          <YAxis
            tick={{ fontSize: 11, fill: "#6B6B6B" }}
            tickLine={false}
            axisLine={{ stroke: "#e5e5e5" }}
            tickFormatter={(v) => formatINR(v, { precision: 0 })}
            width={70}
          />
          <Tooltip
            contentStyle={{ borderRadius: 2, border: "1px solid #e5e5e5", fontSize: 12 }}
            formatter={(v: any) => [formatINR(Number(v)), metric === "revenue" ? "Revenue" : "Net profit"]}
            labelStyle={{ color: "#111" }}
          />
          <Line type="monotone" dataKey={metric} stroke={stroke} strokeWidth={2} dot={{ r: 3, fill: stroke }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
