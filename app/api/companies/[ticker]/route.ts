import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanTicker } from "@/lib/api";
import { withGrowth, profitTransitionLabel } from "@/lib/growth";
import { validateMetricPair } from "@/lib/validation";

// GET /api/companies/[ticker]
// Returns: { company, quarters: [...with QoQ/YoY growth] }
export async function GET(_req: NextRequest, { params }: { params: { ticker: string } }) {
  const ticker = cleanTicker(decodeURIComponent(params.ticker));
  if (!ticker) return jsonError("invalid ticker", 400);

  const sb = supabaseServer();
  const [
    { data: company, error: cErr },
    { data: quarters, error: qErr },
    { data: events },
  ] = await Promise.all([
    sb.from("companies").select("*").eq("ticker", ticker).maybeSingle(),
    sb.from("quarterly_financials")
      .select("id,ticker,quarter_label,quarter_end_date,fiscal_year,fiscal_quarter,revenue,net_profit,operating_profit,eps,currency,data_quality_status,fetched_at,source")
      .eq("ticker", ticker)
      .order("quarter_end_date", { ascending: true }),
    sb.from("announcement_events")
      .select("announcement_date,raw_json")
      .eq("ticker", ticker)
      .eq("status", "fetched")
      .order("announcement_date", { ascending: false }),
  ]);

  if (cErr) return jsonError(cErr.message, 500);
  if (qErr) return jsonError(qErr.message, 500);
  if (!company) return jsonError("company not found", 404);

  type EventRow = { announcement_date: string; raw_json: any };
  const eventsWithUrl = (events ?? [])
    .filter((e: EventRow) => typeof e.raw_json?.filing_url === "string")
    .map((e: EventRow) => ({
      date: e.announcement_date,
      url: e.raw_json.filing_url as string,
    }));

  function filingUrlFor(quarterEnd: string): string | null {
    const qEndMs = Date.parse(quarterEnd);
    if (Number.isNaN(qEndMs)) return null;
    let best: { delta: number; url: string } | null = null;
    for (const e of eventsWithUrl) {
      const evMs = Date.parse(e.date);
      if (Number.isNaN(evMs)) continue;
      const delta = evMs - qEndMs;
      if (delta < 0 || delta > 90 * 86_400_000) continue;
      if (!best || delta < best.delta) best = { delta, url: e.url };
    }
    return best?.url ?? null;
  }

  const sanitizedBase = (quarters ?? []).map((q, i) => {
    const prevY = i >= 4 ? (quarters ?? [])[i - 4] : null;
    const prevYSanitized = prevY
      ? validateMetricPair(
          { revenue: prevY.revenue, net_profit: prevY.net_profit },
          {
            company_name: company.company_name,
            sector: company.sector,
            industry: company.industry,
            market_cap_bucket: company.market_cap_bucket,
            source: "company_detail_prev_y",
            financial_source: prevY.source,
          }
        )
      : null;
    const sanitized = validateMetricPair(
      { revenue: q.revenue, net_profit: q.net_profit },
      {
        company_name: company.company_name,
        sector: company.sector,
        industry: company.industry,
        market_cap_bucket: company.market_cap_bucket,
        source: "company_detail",
        financial_source: q.source,
        require_verified: i === (quarters ?? []).length - 1,
      },
      { revenue: prevYSanitized?.revenue ?? null, net_profit: prevYSanitized?.net_profit ?? null }
    );

    return {
      ...q,
      revenue: sanitized.revenue,
      net_profit: sanitized.net_profit,
      profit_yoy_label: profitTransitionLabel(sanitized.net_profit, prevYSanitized?.net_profit ?? null),
      revenue_validation_issue: sanitized.revenue_issue,
      net_profit_validation_issue: sanitized.net_profit_issue,
      filing_url: filingUrlFor(q.quarter_end_date),
    };
  });

  const withPct = withGrowth(
    sanitizedBase.map((q) => ({
      quarter_end_date: q.quarter_end_date,
      revenue: q.revenue,
      net_profit: q.net_profit,
    }))
  );

  const enriched = sanitizedBase.map((q, i) => ({
    ...q,
    revenue_qoq: withPct[i]?.revenue_qoq ?? null,
    revenue_yoy: withPct[i]?.revenue_yoy ?? null,
    profit_qoq: withPct[i]?.profit_qoq ?? null,
    profit_yoy: withPct[i]?.profit_yoy ?? null,
  }));

  const latest_filing_url = eventsWithUrl.length > 0 ? eventsWithUrl[0].url : null;

  return jsonOk({ company, quarters: enriched, latest_filing_url });
}
