import { NextRequest } from "next/server";
import { jsonOk, jsonError } from "@/lib/api";

// GET /api/prices?tickers=HCLTECH.NS,RELIANCE.NS,TCS.NS
//   (or no tickers param → returns everything we have on hand)
//
// Reads the latest stock_price snapshot from fetch_logs (populated by
// scripts/stock_prices.py) and returns a ticker → {last_price, change_pct,
// previous_close, day_high, day_low, volume, updated_at} map.
//
// The UI uses this in two places:
//   - Homepage CompanyTable: a small current-price cell under the ticker
//   - Company detail page: a prominent "Trading" KPI tile with live price
//     + day change
//
// Shape:
//   {
//     ok: true,
//     data: {
//       market_status: "open" | "closed" | "stale",
//       as_of: "2026-04-22T09:15:00Z",
//       prices: {
//         "HCLTECH.NS": { last_price: 1450.20, change_pct: 0.0095, ... },
//         ...
//       }
//     }
//   }

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// 7-day cap past which last-close is too stale to serve even as
// "closed". The UI silently falls to nulls in that case.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Is the Indian equity market open right now (Mon-Fri 09:15-15:30 IST)?
// The LIVE/CLOSED chip tracks the MARKET state, not our data age — a
// 10-min cron lag shouldn't flip the UI off during active trading.
function isIndianMarketOpen(now: Date = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour    = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute  = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  if (["Sat", "Sun"].includes(weekday)) return false;
  const mins = hour * 60 + minute;
  return mins >= (9 * 60 + 15) && mins <= (15 * 60 + 30);
}

export async function GET(req: NextRequest) {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return jsonError("supabase env missing", 500);

  const tickersParam = req.nextUrl.searchParams.get("tickers");
  const wanted: string[] | null = tickersParam
    ? tickersParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 1500)        // safety cap
    : null;

  // PostgREST direct fetch (like market-context) — supabase-js's fetch
  // otherwise gets cached by Next.js data cache indefinitely.
  const params = new URLSearchParams({
    select: "ticker,message,fetched_at",
    source: "eq.stock_price",
    order: "fetched_at.desc",
  });
  if (wanted && wanted.length > 0) {
    // Quote each ticker — values may contain commas inside a future
    // ticker format. PostgREST in.() expects quoted csv.
    params.set(
      "ticker",
      `in.(${wanted.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",")})`,
    );
    // One row per ticker is plenty; pull 2x wanted so dedupe has options.
    params.set("limit", String(Math.min(wanted.length * 2, 3000)));
  } else {
    // Server-wide: cap at 2500 rows (~2 sweeps × 1076 tickers) then dedupe.
    params.set("limit", "2500");
  }

  const r = await fetch(`${url}/rest/v1/fetch_logs?${params.toString()}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!r.ok) return jsonError(`supabase ${r.status}`, 500);
  const rows = (await r.json()) as Array<{
    ticker: string; message: string | null; fetched_at: string;
  }>;

  type Price = {
    last_price: number | null;
    previous_close: number | null;
    change_pct: number | null;
    day_high: number | null;
    day_low: number | null;
    volume: number | null;
    updated_at: string;
  };

  const latest = new Map<string, Price>();
  let mostRecent = "";
  let oldestUsed = Infinity;
  for (const row of rows ?? []) {
    if (latest.has(row.ticker)) continue;
    try {
      const p = JSON.parse(row.message || "{}");
      const age = Date.now() - new Date(row.fetched_at).getTime();
      if (age > MAX_AGE_MS) continue;
      latest.set(row.ticker, {
        last_price:     typeof p.last_price     === "number" ? p.last_price     : null,
        previous_close: typeof p.previous_close === "number" ? p.previous_close : null,
        change_pct:     typeof p.change_pct     === "number" ? p.change_pct     : null,
        day_high:       typeof p.day_high       === "number" ? p.day_high       : null,
        day_low:        typeof p.day_low        === "number" ? p.day_low        : null,
        volume:         typeof p.volume         === "number" ? p.volume         : null,
        updated_at:     row.fetched_at,
      });
      if (row.fetched_at > mostRecent) mostRecent = row.fetched_at;
      if (age < oldestUsed) oldestUsed = age;
    } catch {
      /* skip malformed row */
    }
  }

  const prices: Record<string, Price> = {};
  for (const [t, p] of latest) prices[t] = p;

  // Base the chip on actual NSE/BSE trading hours, not our data age.
  // Even if the snapshot cron is 10 min late, the strip still correctly
  // reads "LIVE" during live trading — readers care about the MARKET
  // state, not our pipeline's staleness. Freshness is surfaced
  // separately via the updated_at timestamp.
  const marketOpen = isIndianMarketOpen();
  const market_status: "open" | "closed" | "stale" =
    !Number.isFinite(oldestUsed) ? "stale"
      : oldestUsed > MAX_AGE_MS ? "stale"
      : marketOpen ? "open"
      : "closed";

  return jsonOk({
    as_of: mostRecent || new Date().toISOString(),
    market_status,
    prices,
  });
}
