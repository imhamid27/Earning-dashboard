import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanTicker } from "@/lib/api";
import { withGrowth } from "@/lib/growth";

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
      .select("id,ticker,quarter_label,quarter_end_date,fiscal_year,fiscal_quarter,revenue,net_profit,operating_profit,eps,currency,data_quality_status,fetched_at")
      .eq("ticker", ticker)
      .order("quarter_end_date", { ascending: true }),
    // Pull every fetched announcement for this ticker so we can stitch a
    // filing PDF URL onto each matching quarter row. The match is by
    // announcement_date: the filing is usually published on (or within a
    // day of) the board-meeting date the calendars track.
    sb.from("announcement_events")
      .select("announcement_date,raw_json")
      .eq("ticker", ticker)
      .eq("status", "fetched")
      .order("announcement_date", { ascending: false }),
  ]);

  if (cErr) return jsonError(cErr.message, 500);
  if (qErr) return jsonError(qErr.message, 500);
  if (!company) return jsonError("company not found", 404);

  const withPct = withGrowth(
    (quarters ?? []).map((q) => ({
      quarter_end_date: q.quarter_end_date,
      revenue: q.revenue,
      net_profit: q.net_profit
    }))
  );

  // Build a date→filing_url map. The filing date is usually within 45 days
  // AFTER the quarter-end, so for each quarter we attach the nearest filing
  // event that falls in that window.
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
    // Accept events within (quarter_end, quarter_end + 90 days]. Pick the
    // earliest one — that's the actual results filing; later ones are
    // usually addendums or correction notices.
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

  // Stitch growth metrics + filing URL back onto the original rows.
  const enriched = (quarters ?? []).map((q, i) => ({
    ...q,
    revenue_qoq: withPct[i]?.revenue_qoq ?? null,
    revenue_yoy: withPct[i]?.revenue_yoy ?? null,
    profit_qoq:  withPct[i]?.profit_qoq  ?? null,
    profit_yoy:  withPct[i]?.profit_yoy  ?? null,
    filing_url:  filingUrlFor(q.quarter_end_date),
  }));

  // Most recent filing URL overall — used for the "View latest filing"
  // link in the company page header.
  const latest_filing_url = eventsWithUrl.length > 0 ? eventsWithUrl[0].url : null;

  return jsonOk({ company, quarters: enriched, latest_filing_url });
}
