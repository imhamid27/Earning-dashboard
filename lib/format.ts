// Number + currency formatters tuned for Indian financial reporting.
// All monetary amounts are stored as raw rupees in the DB and displayed
// in Crores — we NEVER mix Lakhs and Crores in the same UI.

import { TURNED_PROFITABLE, TURNED_LOSS_MAKING } from "@/lib/growth";

const CRORE = 1e7;

// Format a raw rupee amount like 1_234_500_000 into "₹123.45 Cr".
// Always uses Crores as the unit so every table cell is directly comparable —
// no mixing "₹50 L" with "₹1,200 Cr" in the same view.
export function formatINR(
  value: number | null | undefined,
  opts: { compact?: boolean; suffix?: boolean; precision?: number } = {}
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const { compact = true, suffix = true, precision = 2 } = opts;

  if (!compact) {
    return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: precision })}`;
  }

  // Always show in Crores. Sub-crore amounts show as "₹0.XX Cr" so the unit
  // is consistent across every row in every table. The only exception is
  // amounts below ₹1 (essentially zero after rounding) which we show as "₹0".
  const abs = Math.abs(value);
  if (abs < 1) {
    return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  }
  const num = value / CRORE;
  const formatted = num.toLocaleString("en-IN", {
    maximumFractionDigits: precision,
    minimumFractionDigits: Math.abs(num) < 10 ? Math.min(precision, 2) : 0,
  });
  return suffix ? `₹${formatted} Cr` : `₹${formatted}`;
}

// Render a decimal percent change (0.123) as "+12.3%". Handles null and the
// TURNED_PROFITABLE / TURNED_LOSS_MAKING sentinels from lib/growth.ts.
//
// Use this for narrative/inline text. For table cells, use formatYoY which
// prepends directional ▲/▼ arrows for at-a-glance scanning.
export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === TURNED_PROFITABLE)  return "Turned profitable";
  if (value === TURNED_LOSS_MAKING) return "Turned loss-making";
  // Extreme ratios from a near-zero base — still not meaningful as a number.
  if (Math.abs(value) > 9.99) return "n/m";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

// Format a YoY/QoQ ratio for data-table cells, prepending ▲/▼ so direction
// is readable without relying solely on colour (accessibility, print).
// "▲ +8.9%" | "▼ -12.3%" | "Turned profitable" | "Turned loss-making" | "—"
// Never shows conflicting sign + arrow (e.g. "▼ +8.9%" is impossible here).
export function formatYoY(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === TURNED_PROFITABLE)  return "Turned profitable";
  if (value === TURNED_LOSS_MAKING) return "Turned loss-making";
  if (Math.abs(value) > 9.99) return "n/m";
  const abs = (Math.abs(value) * 100).toFixed(digits);
  if (value > 0) return `▲ +${abs}%`;
  if (value < 0) return `▼ -${abs}%`;
  return `0.${Array(digits).fill("0").join("")}%`;
}

// Tailwind class for a growth number — green up, red down, muted neutral.
// Also handles the TURNED_* sentinels so colour is always semantically correct.
export function pctToneClass(value: number | null | undefined): string {
  if (value === TURNED_PROFITABLE)  return "text-core-teal";
  if (value === TURNED_LOSS_MAKING) return "text-core-negative";
  if (value == null || !Number.isFinite(value)) return "text-core-muted";
  if (value > 0) return "text-core-teal";
  if (value < 0) return "text-core-negative";
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
