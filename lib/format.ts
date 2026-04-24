// Number + currency formatters tuned for Indian financial reporting.
// Companies report in crores/lakhs, so we always format large numbers that way.

const CRORE = 1e7;
const LAKH  = 1e5;

// Format a raw rupee amount like 1_234_500_000 into "₹123.45 Cr".
// Pass opts.compact = false for "12,34,50,00,000" style.
export function formatINR(
  value: number | null | undefined,
  opts: { compact?: boolean; suffix?: boolean; precision?: number } = {}
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const { compact = true, suffix = true, precision = 2 } = opts;

  if (!compact) {
    return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: precision })}`;
  }

  const abs = Math.abs(value);
  let num: number;
  let unit: string;
  if (abs >= CRORE) {
    num = value / CRORE;
    unit = "Cr";
  } else if (abs >= LAKH) {
    num = value / LAKH;
    unit = "L";
  } else {
    return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  }
  const formatted = num.toLocaleString("en-IN", {
    maximumFractionDigits: precision,
    minimumFractionDigits: num < 10 ? Math.min(precision, 2) : 0
  });
  return suffix ? `₹${formatted} ${unit}` : `₹${formatted}`;
}

// Render a decimal percent change (0.123) as "+12.3%". Handles null gracefully.
// Caps absurd values (> ±999%) as "n/m" (not meaningful) — those almost always
// come from a tiny base (e.g. holding companies where revenue is a rounding
// error) and reporting them as real growth is misleading.
export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) > 9.99) return "n/m";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

// Tailwind class for a growth number — green up, red down, muted neutral.
export function pctToneClass(value: number | null | undefined): string {
  // Brand: teal for growth, red for contraction.
  if (value == null || !Number.isFinite(value)) return "text-core-muted";
  if (value > 0)  return "text-core-teal";
  if (value < 0)  return "text-core-negative";
  return "text-core-muted";
}

// Short calendar date: "31 Mar 2026"
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Human age of a timestamp: "2h ago" / "3d ago". Used for freshness pills.
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const diffS = Math.max(0, (Date.now() - then) / 1000);
  if (diffS < 60)       return `${Math.floor(diffS)}s ago`;
  if (diffS < 3600)     return `${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400)    return `${Math.floor(diffS / 3600)}h ago`;
  if (diffS < 86400*30) return `${Math.floor(diffS / 86400)}d ago`;
  return `${Math.floor(diffS / (86400 * 30))}mo ago`;
}
