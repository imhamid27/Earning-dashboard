"use client";

// Tiny inline sparkline for the company table. SVG only — no chart lib needed
// for something this small, and it avoids ~70KB of Recharts per row.
export default function Sparkline({
  data,
  width = 80,
  height = 24,
  stroke = "#EC2D7A"  // The Core brand pink
}: {
  data: Array<{ v: number | null }>;
  width?: number;
  height?: number;
  stroke?: string;
}) {
  const vals = data.map((d) => d.v).filter((v): v is number => v != null);
  if (vals.length < 2) return <span className="text-core-muted text-xs">—</span>;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const step = width / Math.max(1, data.length - 1);
  const pts = data
    .map((d, i) => (d.v == null ? null : `${(i * step).toFixed(1)},${(height - ((d.v - min) / range) * height).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="block">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
