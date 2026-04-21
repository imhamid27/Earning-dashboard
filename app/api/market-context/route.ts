import { NextRequest } from "next/server";
import { jsonOk, jsonError } from "@/lib/api";

// GET /api/market-context
//
// Supporting market context — Nifty 50 / Sensex / Bank Nifty. Fetches
// Yahoo Finance's v8/chart endpoint per symbol, cached in-process for
// 5 min, and computes % change from (price − chartPreviousClose).
//
// Previous implementation used Next's built-in fetch cache, but that
// cached 429 responses just as eagerly as successes — meaning a single
// burst that tripped Yahoo's per-host limit would lock us out for the
// full TTL. In-process cache here only stores *successful* reads, so
// failed fetches are retried on the next request.

export const dynamic = "force-dynamic";

const YF_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

const INDICES: Array<{ key: string; name: string; symbol: string }> = [
  { key: "nifty50",    name: "Nifty 50",   symbol: "^NSEI"    },
  { key: "sensex",     name: "Sensex",     symbol: "^BSESN"   },
  { key: "bank_nifty", name: "Bank Nifty", symbol: "^NSEBANK" },
];

const CACHE_MS = 5 * 60 * 1000;
type CacheEntry = { change_pct: number; at: number };
const CACHE = new Map<string, CacheEntry>();

async function hitOnce(symbol: string): Promise<number | null> {
  const url = `${YF_CHART}/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
    },
    cache: "no-store",
  });
  if (!r.ok) {
    console.warn(`[market-context] ${symbol} upstream ${r.status}`);
    throw new Error(`upstream ${r.status}`);
  }
  const json = (await r.json()) as any;
  const meta = json?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  const prev  = meta?.chartPreviousClose ?? meta?.previousClose;
  if (typeof price !== "number" || typeof prev !== "number" || prev === 0) {
    console.warn(`[market-context] ${symbol} missing price/prev`, { price, prev });
    return null;
  }
  return (price - prev) / prev;
}

async function fetchIndex(symbol: string): Promise<number | null> {
  const cached = CACHE.get(symbol);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.change_pct;
  // Yahoo's edge occasionally 429s the 3rd parallel-ish request from a
  // single IP. One retry with a ~1s cooldown gets around it.
  let val: number | null = null;
  try { val = await hitOnce(symbol); }
  catch {
    await new Promise((r) => setTimeout(r, 1000));
    try { val = await hitOnce(symbol); } catch { val = null; }
  }
  if (val != null) CACHE.set(symbol, { change_pct: val, at: Date.now() });
  return val;
}

export async function GET(_req: NextRequest) {
  const changes: Array<number | null> = [];
  // Serial with 250 ms stagger — Yahoo 429s when we parallel-hit 3
  // symbols simultaneously from the same egress.
  for (let i = 0; i < INDICES.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 250));
    changes.push(await fetchIndex(INDICES[i].symbol));
  }
  const indices = INDICES.map((i, idx) => ({
    key: i.key,
    name: i.name,
    change_pct: changes[idx],
  }));
  if (indices.every((x) => x.change_pct == null)) {
    return jsonError("upstream unavailable", 502);
  }
  return jsonOk({ as_of: new Date().toISOString(), indices });
}
