// Derive a one-line, factual insight from a company's quarterly row.
// Reads the revenue / profit / YoY numbers and picks the most prominent
// honest observation. Never synthetic, never generic AI language.

import { TURNED_PROFITABLE, TURNED_LOSS_MAKING } from "./growth";
import type { LatestQuarterRow } from "./types";

// Classify this quarter's result as Strong / Weak / Mixed / null (not enough data).
// Used for the quality-tag chip in the main table.
//   Strong: meaningful profit growth (>15%) OR turned profitable
//   Weak:   profit declined significantly (<-10%) OR turned loss-making
//   Mixed:  everything in between (positive revenue, flat/slight profit dip, etc.)
export function resultQuality(
  row: Pick<LatestQuarterRow, "profit_yoy" | "revenue_yoy" | "status">
): "strong" | "weak" | "mixed" | null {
  if (row.status !== "announced_with_numbers") return null;
  const p = row.profit_yoy;
  const r = row.revenue_yoy;
  if (p == null && r == null) return null;

  const profitStrong = p != null && (p === TURNED_PROFITABLE || p > 0.15);
  const profitWeak   = p != null && (p === TURNED_LOSS_MAKING || p < -0.10);
  const revGood      = r != null && r > 0;
  const revBad       = r != null && r < -0.05;

  if (profitStrong && !revBad)  return "strong";
  if (profitWeak   && !revGood) return "weak";
  if (profitWeak   || revBad)   return "weak";   // one leg clearly bad
  if (profitStrong || revGood)  return "strong";  // one leg clearly good
  if (p != null    || r != null) return "mixed";
  return null;
}

export function deriveInsight(row: LatestQuarterRow): string | null {
  if (row.status !== "announced_with_numbers") return null;

  const rYoy = row.revenue_yoy;
  const pYoy = row.profit_yoy;
  const hasRev    = rYoy != null && Number.isFinite(rYoy);
  const hasProfit = pYoy != null && Number.isFinite(pYoy);

  // Sign-flip sentences — highest priority.
  if (pYoy === TURNED_PROFITABLE)  return "Swung from a loss to profit — a positive turnaround.";
  if (pYoy === TURNED_LOSS_MAKING) return "Slipped into a loss after a profitable prior year.";

  // Strong double-beat
  if (hasRev && hasProfit && rYoy! > 0.15 && pYoy! > 0.20) {
    return "Broad-based growth — both revenue and profit rose sharply.";
  }

  // Margin expansion — profit outpaced revenue
  if (hasRev && hasProfit && rYoy! > 0 && pYoy! > rYoy! + 0.10) {
    return "Profit growth outpaced revenue, pointing to better margins.";
  }

  // Margin pressure — revenue up, profit down
  if (hasRev && hasProfit && rYoy! > 0.05 && pYoy! < -0.05) {
    return "Top-line growth, but margins compressed.";
  }

  // Both falling
  if (hasRev && hasProfit && rYoy! < -0.05 && pYoy! < -0.05) {
    return "Revenue and profit both slipped versus last year.";
  }

  // Strong single metric
  if (hasProfit && pYoy! > 0.30) {
    return "Profit rose strongly on the year.";
  }
  if (hasRev && rYoy! > 0.15) {
    return "Revenue grew in double digits year-on-year.";
  }

  // Clear declines
  if (hasProfit && pYoy! < -0.15) {
    return "Profit fell sharply year-on-year.";
  }
  if (hasRev && rYoy! < -0.10) {
    return "Revenue declined versus the same quarter last year.";
  }

  // Steady
  if (hasRev && hasProfit && Math.abs(rYoy!) < 0.05 && Math.abs(pYoy!) < 0.05) {
    return "A steady quarter — headline numbers little changed.";
  }

  return null;
}

// User-facing status text — the single place this mapping is defined.
// `variant: "full"` = prose for cards and subheadings ("Results announced
// on 19 Apr 2026"); `variant: "compact"` = pill-friendly short form that
// stays single-line in narrow columns ("Announced 19 Apr").
export function statusLabel(
  status: LatestQuarterRow["status"] | undefined,
  resultDate: string | null | undefined,
  nextResultDate: string | null | undefined,
  fmtDate: (iso: string | null | undefined) => string,
  variant: "full" | "compact" = "full"
): string {
  // Compact variant strips the year — a chip shows only the day + month
  // since the year is obvious from the dashboard's current quarter context.
  const compactDate = (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  };

  switch (status) {
    case "announced_with_numbers":
    case "announced":
      if (variant === "compact") {
        return resultDate ? `Announced ${compactDate(resultDate)}` : "Announced";
      }
      return resultDate ? `Results announced on ${fmtDate(resultDate)}` : "Results announced";
    case "scheduled":
      if (variant === "compact") {
        return nextResultDate ? `Expected ${compactDate(nextResultDate)}` : "Expected";
      }
      return nextResultDate ? `Results expected on ${fmtDate(nextResultDate)}` : "Awaiting announcement";
    case "awaiting":
    default:
      return variant === "compact" ? "Awaiting" : "Awaiting announcement";
  }
}
