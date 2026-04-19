// Horizontal inline bar — used in table cells to give scale to raw
// numbers. The bar's width is proportional to `value / max`. Color is
// always brand-ink; the number sits above and steals the attention.
export default function InlineBar({
  value, max, width = 100, height = 4
}: {
  value: number | null | undefined;
  max: number;
  width?: number;
  height?: number;
}) {
  if (value == null || !Number.isFinite(value) || max <= 0) {
    return <div style={{ width, height }} className="bg-core-line rounded-full" />;
  }
  const pct = Math.max(0, Math.min(1, Math.abs(value) / max));
  return (
    <div style={{ width, height }} className="bg-core-line rounded-full overflow-hidden">
      <div
        style={{ width: `${(pct * 100).toFixed(1)}%`, height: "100%" }}
        className={value >= 0 ? "bg-core-ink" : "bg-core-negative"}
      />
    </div>
  );
}
