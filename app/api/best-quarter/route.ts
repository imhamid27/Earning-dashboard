import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError } from "@/lib/api";
import { compareQuarterLabels } from "@/lib/fiscal";

// GET /api/best-quarter?min=100
//
// Returns the most-recent quarter that has at least `min` reporters.
// The dashboard uses this to choose a "context" quarter for its main table
// so readers see real data instead of a near-empty current quarter.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const min = Number(url.searchParams.get("min") || "100");
  const sb = supabaseServer();

  // Fetch quarter_label + ticker, paginated.
  const PAGE = 1000;
  const seen: Array<{ quarter_label: string; ticker: string }> = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await sb
      .from("quarterly_financials")
      .select("quarter_label,ticker")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) return jsonError(error.message, 500);
    if (!data || data.length === 0) break;
    seen.push(...data as any);
    if (data.length < PAGE) break;
  }

  const byQuarter = new Map<string, Set<string>>();
  for (const r of seen) {
    if (!byQuarter.has(r.quarter_label)) byQuarter.set(r.quarter_label, new Set());
    byQuarter.get(r.quarter_label)!.add(r.ticker);
  }
  const candidates = Array.from(byQuarter.entries())
    .map(([q, tickers]) => ({ quarter_label: q, reporters: tickers.size }))
    .filter((r) => r.reporters >= min)
    .sort((a, b) => -compareQuarterLabels(a.quarter_label, b.quarter_label));

  return jsonOk({ min, best: candidates[0] ?? null, all_with_coverage: candidates });
}
