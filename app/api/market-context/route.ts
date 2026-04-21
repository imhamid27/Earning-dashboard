import { NextRequest } from "next/server";
import { jsonOk, jsonError } from "@/lib/api";

// GET /api/market-context
//
// Reads the latest Nifty 50 / Sensex / Bank Nifty snapshots written by
// scripts/market_snapshot.py into fetch_logs. Serving from Supabase
// means the dashboard never hits Yahoo at request-time — our serverless
// egress has been rate-limited under load. The Python script that
// populates these rows runs from GitHub Actions (fresh IP per run)
// where yfinance's cookie+crumb handshake works reliably.
//
// Response shape:
//   {
//     ok: true,
//     data: {
//       as_of: "2026-04-21T10:12:00Z",   // most recent snapshot time
//       indices: [
//         { key: "nifty50",    name: "Nifty 50",   change_pct: 0.0087 },
//         { key: "sensex",     name: "Sensex",     change_pct: 0.0071 },
//         { key: "bank_nifty", name: "Bank Nifty", change_pct: 0.0124 }
//       ]
//     }
//   }
//
// change_pct is a decimal (0.0087 = +0.87%). The UI hides the strip
// entirely if the response is an error or every value is null.

export const dynamic = "force-dynamic";
// Supabase client uses global fetch under the hood; Next.js otherwise
// caches those calls indefinitely in production builds, which pinned
// this route to the first snapshot on server start. Force every
// fetch — Supabase included — to bypass the cache.
export const fetchCache = "force-no-store";

const ORDER: Array<{ key: string; ticker: string; fallbackName: string }> = [
  { key: "nifty50",    ticker: "^NSEI",    fallbackName: "Nifty 50"   },
  { key: "sensex",     ticker: "^BSESN",   fallbackName: "Sensex"     },
  { key: "bank_nifty", ticker: "^NSEBANK", fallbackName: "Bank Nifty" },
];

const MAX_STALE_MS = 2 * 60 * 60 * 1000; // 2 hours — past this we'd rather
                                         // hide than show stale data.

export async function GET(_req: NextRequest) {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return jsonError("supabase env missing", 500);

  // Go direct to PostgREST instead of through supabase-js so we can
  // pass cache:'no-store' on the underlying fetch. supabase-js's
  // bundled fetch gets cached by Next's data cache otherwise.
  const params = new URLSearchParams({
    select: "ticker,message,fetched_at",
    source: "eq.market_snapshot",
    ticker: `in.(${ORDER.map((o) => `"${o.ticker}"`).join(",")})`,
    order: "fetched_at.desc",
    limit: "60",
  });
  const r = await fetch(`${url}/rest/v1/fetch_logs?${params.toString()}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    cache: "no-store",
  });
  if (!r.ok) return jsonError(`supabase ${r.status}`, 500);
  const data = (await r.json()) as Array<{
    ticker: string;
    message: string | null;
    fetched_at: string;
  }>;

  // Keep the most-recent row per ticker.
  const latest = new Map<string, {
    change_pct: number | null;
    last_price: number | null;
    name: string;
    fetched_at: string;
  }>();
  for (const row of data ?? []) {
    if (latest.has(row.ticker)) continue;
    try {
      const parsed = JSON.parse(row.message || "{}");
      latest.set(row.ticker, {
        change_pct: typeof parsed.change_pct === "number" ? parsed.change_pct : null,
        last_price: typeof parsed.last_price === "number" ? parsed.last_price : null,
        name: typeof parsed.name === "string" ? parsed.name : "",
        fetched_at: row.fetched_at,
      });
    } catch {
      // Malformed message — skip this row, try the next one for this ticker.
    }
  }

  let mostRecent = "";
  const indices = ORDER.map(({ key, ticker, fallbackName }) => {
    const got = latest.get(ticker);
    if (!got) return { key, name: fallbackName, change_pct: null, last_price: null };
    // Drop values that are more than MAX_STALE_MS old — stale market data
    // is worse than no market data.
    const age = Date.now() - new Date(got.fetched_at).getTime();
    if (age > MAX_STALE_MS) return { key, name: got.name || fallbackName, change_pct: null, last_price: null };
    if (got.fetched_at > mostRecent) mostRecent = got.fetched_at;
    return {
      key,
      name: got.name || fallbackName,
      change_pct: got.change_pct,
      last_price: got.last_price,
    };
  });

  if (indices.every((x) => x.change_pct == null)) {
    return jsonError("no recent market snapshot", 502);
  }
  return jsonOk({
    as_of: mostRecent || new Date().toISOString(),
    indices,
  });
}
