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
//       as_of:  "2026-04-21T10:12:00Z",   // most recent snapshot time
//       market_status: "open" | "closed" | "stale",
//       indices: [
//         { key: "nifty50", name: "Nifty 50", change_pct: 0.0087, last_price: 24576.6 },
//         ...
//       ]
//     }
//   }
//
// change_pct is a decimal (0.0087 = +0.87%). The strip ALWAYS renders
// on the homepage — outside trading hours we just tag the values as
// "Closed" so readers know the last-traded level rather than hiding
// the whole strip.

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

// Upper bound on how old we'll ever serve. At some point the last-close
// is meaningless (e.g. extended holiday + outage). We still show it so
// the strip never disappears, but we tag it "Stale" so it's visually
// deprioritised.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Is the Indian equity market open right now (Mon-Fri 09:15-15:30 IST)?
// This is the single source of truth for the LIVE/CLOSED chip — the chip
// describes the MARKET, not our data freshness. That way a 10-minute cron
// lag doesn't flip the UI to "Closed" while trading is actually live.
// Data staleness is still visible via the "Last close Xm ago" timestamp.
function isIndianMarketOpen(now: Date = new Date()): boolean {
  // Pull IST weekday + HH:MM via Intl, so this works on any server TZ.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour    = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute  = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  if (["Sat", "Sun"].includes(weekday)) return false;
  const mins = hour * 60 + minute;
  // NSE/BSE regular session: 09:15 open, 15:30 close.
  return mins >= (9 * 60 + 15) && mins <= (15 * 60 + 30);
}

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
  let oldestAge = 0;
  const indices = ORDER.map(({ key, ticker, fallbackName }) => {
    const got = latest.get(ticker);
    if (!got) return { key, name: fallbackName, change_pct: null, last_price: null };
    const age = Date.now() - new Date(got.fetched_at).getTime();
    // Past MAX_AGE_MS we consider the data too stale to even be "last close"
    // (e.g. a week of downtime); null it out so the UI shows a dash but
    // keeps the strip visible with the other indices.
    if (age > MAX_AGE_MS) {
      return { key, name: got.name || fallbackName, change_pct: null, last_price: null };
    }
    if (got.fetched_at > mostRecent) mostRecent = got.fetched_at;
    if (age > oldestAge) oldestAge = age;
    return {
      key,
      name: got.name || fallbackName,
      change_pct: got.change_pct,
      last_price: got.last_price,
    };
  });

  // Tag the strip as open/closed/stale. The indicator tracks the MARKET,
  // not our data age — so even if the snapshot cron is 10 minutes late,
  // the strip still shows "LIVE" during NSE/BSE trading hours (which
  // matches the reader's expectation). We only fall to "stale" when the
  // underlying data is genuinely too old to be usable.
  const marketOpen = isIndianMarketOpen();
  const market_status: "open" | "closed" | "stale" =
    oldestAge === 0 ? "stale"                  // no data at all
      : oldestAge > MAX_AGE_MS ? "stale"       // older than 7 days
      : marketOpen ? "open"                    // in session → LIVE
      : "closed";                               // off-hours → last close

  return jsonOk({
    as_of: mostRecent || new Date().toISOString(),
    market_status,
    indices,
  });
}
