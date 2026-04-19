// Derive a one-line, factual insight from a company's quarterly row.
// Reads the revenue / profit / YoY numbers and picks the most prominent
// honest observation. Never synthetic, never generic AI language.

import type { LatestQuarterRow } from "./types";

export function deriveInsight(row: LatestQuarterRow): string | null {
  if (row.status !== "announced_with_numbers") return null;

  const rYoy = row.revenue_yoy;
  const pYoy = row.profit_yoy;
  const hasRev = rYoy != null && Number.isFinite(rYoy);
  const hasProfit = pYoy != null && Number.isFinite(pYoy);

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
export function statusLabel(
  status: LatestQuarterRow["status"] | undefined,
  resultDate: string | null | undefined,
  nextResultDate: string | null | undefined,
  fmtDate: (iso: string | null | undefined) => string
): string {
  switch (status) {
    case "announced_with_numbers":
      return resultDate ? `Results announced on ${fmtDate(resultDate)}` : "Results announced";
    case "announced":
      return resultDate ? `Results announced on ${fmtDate(resultDate)}` : "Results announced";
    case "scheduled":
      return nextResultDate ? `Results expected on ${fmtDate(nextResultDate)}` : "Awaiting announcement";
    case "awaiting":
    default:
      return "Awaiting announcement";
  }
}
