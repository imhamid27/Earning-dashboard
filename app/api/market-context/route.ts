import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
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

const ORDER: Array<{ key: string; ticker: string; fallbackName: string }> = [
  { key: "nifty50",    ticker: "^NSEI",    fallbackName: "Nifty 50"   },
  { key: "sensex",     ticker: "^BSESN",   fallbackName: "Sensex"     },
  { key: "bank_nifty", ticker: "^NSEBANK", fallbackName: "Bank Nifty" },
];

const MAX_STALE_MS = 2 * 60 * 60 * 1000; // 2 hours — past this we'd rather
                                         // hide than show stale data.

export async function GET(_req: NextRequest) {
  const sb = supabaseServer();
  const tickers = ORDER.map((o) => o.ticker);
  const { data, error } = await sb
    .from("fetch_logs")
    .select("ticker,message,fetched_at")
    .eq("source", "market_snapshot")
    .in("ticker", tickers)
    .order("fetched_at", { ascending: false })
    .limit(60); // 3 indices × up to 20 recent snapshots — plenty to dedupe.
  if (error) return jsonError(error.message, 500);

  // Keep the most-recent row per ticker.
  const latest = new Map<string, { change_pct: number | null; name: string; fetched_at: string }>();
  for (const row of data ?? []) {
    if (latest.has(row.ticker)) continue;
    try {
      const parsed = JSON.parse(row.message || "{}");
      const change = typeof parsed.change_pct === "number" ? parsed.change_pct : null;
      latest.set(row.ticker, {
        change_pct: change,
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
    if (!got) return { key, name: fallbackName, change_pct: null };
    // Drop values that are more than MAX_STALE_MS old — stale market data
    // is worse than no market data.
    const age = Date.now() - new Date(got.fetched_at).getTime();
    if (age > MAX_STALE_MS) return { key, name: got.name || fallbackName, change_pct: null };
    if (got.fetched_at > mostRecent) mostRecent = got.fetched_at;
    return {
      key,
      name: got.name || fallbackName,
      change_pct: got.change_pct,
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
