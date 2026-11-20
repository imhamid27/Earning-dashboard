import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError, cleanTicker } from "@/lib/api";

// GET /api/peers/RELIANCE.NS
// Returns up to 15 same-sector companies with their latest quarter data,
// sorted by latest revenue descending. Excludes the requested ticker itself.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const ticker = cleanTicker(decodeURIComponent(rawTicker));
  if (!ticker) return jsonError("invalid ticker", 400);

  const sb = supabaseServer();

  // 1. Get this company's sector.
  const { data: self, error: selfErr } = await sb
    .from("companies")
    .select("sector")
    .eq("ticker", ticker)
    .maybeSingle();

  if (selfErr) return jsonError(selfErr.message, 500);
  if (!self?.sector) return jsonOk({ peers: [] });

  // 2. Get all active companies in the same sector (excluding self).
  const { data: peerCos, error: coErr } = await sb
    .from("companies")
    .select("ticker,company_name,exchange,sector,industry,market_cap_bucket")
    .eq("sector", self.sector)
    .eq("is_active", true)
    .neq("ticker", ticker)
    .limit(60);

  if (coErr) return jsonError(coErr.message, 500);
  if (!peerCos || peerCos.length === 0) return jsonOk({ peers: [], sector: self.sector });

  const peerTickers = peerCos.map((c) => c.ticker);

  // 3. Fetch the latest quarter row for each peer in one query.
  //    Order ascending so the last row per ticker is the newest; we'll pick
  //    it in JS rather than relying on a window function.
  const { data: quarters, error: qErr } = await sb
    .from("quarterly_financials")
    .select("ticker,quarter_label,quarter_end_date,revenue,net_profit,operating_profit,eps,source")
    .in("ticker", peerTickers)
    .order("quarter_end_date", { ascending: true });

  if (qErr) return jsonError(qErr.message, 500);

  // Pick the latest quarter row per ticker.
  const latestByTicker: Record<string, typeof quarters[0]> = {};
  for (const q of quarters ?? []) {
    latestByTicker[q.ticker] = q; // ascending order means last write wins = newest
  }

  // 4. Merge company metadata + latest quarter, sort by revenue desc, cap at 15.
  const peers = peerCos
    .map((co) => ({ ...co, latest: latestByTicker[co.ticker] ?? null }))
    .filter((co) => co.latest?.revenue != null)
    .sort((a, b) => (b.latest!.revenue ?? 0) - (a.latest!.revenue ?? 0))
    .slice(0, 15);

  return jsonOk({ peers, sector: self.sector });
}
