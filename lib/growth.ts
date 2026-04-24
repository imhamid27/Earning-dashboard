// Growth calculations. All values are treated as raw rupees; returns decimals.
//   yoy(100, 80) -> 0.25   (i.e. +25%)
// We deliberately return null when the base is missing, zero, or negative —
// percentage change on a negative base is misleading and should surface as "—".

export function pctChange(curr: number | null | undefined, base: number | null | undefined): number | null {
  if (curr == null || base == null) return null;
  if (!Number.isFinite(curr) || !Number.isFinite(base)) return null;
  if (base <= 0) return null;
  return (curr - base) / base;
}

export function profitTransitionLabel(
  curr: number | null | undefined,
  base: number | null | undefined
): string | null {
  if (curr == null || base == null) return null;
  if (!Number.isFinite(curr) || !Number.isFinite(base)) return null;
  if (base <= 0 && curr > 0) return "Turned profitable";
  if (base > 0 && curr <= 0) return "Turned loss-making";
  return null;
}

export interface QuarterRow {
  quarter_end_date: string; // ISO
  revenue: number | null;
  net_profit: number | null;
}

// Given a chronologically sorted (oldest → newest) array, return the YoY /
// QoQ deltas for each row. Uses 4-quarter lag for YoY and 1-quarter lag for QoQ.
export interface RowWithGrowth extends QuarterRow {
  revenue_qoq: number | null;
  revenue_yoy: number | null;
  profit_qoq: number | null;
  profit_yoy: number | null;
}

export function withGrowth(rows: QuarterRow[]): RowWithGrowth[] {
  const sorted = [...rows].sort((a, b) => a.quarter_end_date.localeCompare(b.quarter_end_date));
  return sorted.map((r, i) => {
    const prevQ = i >= 1 ? sorted[i - 1] : null;
    const prevY = i >= 4 ? sorted[i - 4] : null;
    return {
      ...r,
      revenue_qoq: pctChange(r.revenue, prevQ?.revenue ?? null),
      revenue_yoy: pctChange(r.revenue, prevY?.revenue ?? null),
      profit_qoq:  pctChange(r.net_profit, prevQ?.net_profit ?? null),
      profit_yoy:  pctChange(r.net_profit, prevY?.net_profit ?? null)
    };
  });
}
