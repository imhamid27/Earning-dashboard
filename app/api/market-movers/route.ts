import { NextRequest } from "next/server";
import { jsonOk, jsonError } from "@/lib/api";
import { supabaseServer } from "@/lib/supabase";

// GET /api/market-movers?period=1m&limit=20&sector=IT
//
// period: 1w | 1m | 3m | 6m | 1y | ytd  (default: 1m)
// limit:  1–50                            (default: 20)
// sector: any sector string              (optional)
//
// Response shape:
//   {
//     ok: true,
//     data: {
//       gainers:     MoverRow[],
//       losers:      MoverRow[],
//       period_days: number,
//       as_of:       string,   // ISO date of the latest price used
//     }
//   }
//
// MoverRow: { ticker, company_name, sector, exchange,
//             end_date, start_date, end_price, start_price, return_pct }

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type MoverRow = {
  ticker: string;
  company_name: string;
  sector: string | null;
  exchange: string | null;
  end_date: string;
  start_date: string;
  end_price: number;
  start_price: number;
  return_pct: number;
};

const PERIOD_DAYS: Record<string, number> = {
  "1w":  7,
  "1m":  30,
  "3m":  90,
  "6m":  182,
  "1y":  365,
};

function ytdDays(): number {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  return Math.max(Math.floor((now.getTime() - jan1.getTime()) / 86_400_000), 1);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const periodRaw = (searchParams.get("period") ?? "1m").toLowerCase();
  const limitRaw  = parseInt(searchParams.get("limit") ?? "20", 10);
  const sector    = searchParams.get("sector") ?? null;

  const period_days =
    periodRaw === "ytd"
      ? ytdDays()
      : (PERIOD_DAYS[periodRaw] ?? 30);

  const limit = Math.min(Math.max(isNaN(limitRaw) ? 20 : limitRaw, 1), 50);

  // Sector: allow letters, spaces, & only — same constraint as cleanSector
  const cleanedSector =
    sector && /^[A-Za-z &]+$/.test(sector.trim().slice(0, 40))
      ? sector.trim()
      : null;

  const sb = supabaseServer();

  const { data, error } = await sb.rpc("market_movers", {
    period_days,
    result_limit: limit,
    p_sector: cleanedSector,
  });

  if (error) {
    console.error("[market-movers]", error);
    return jsonError(error.message ?? "rpc failed", 500);
  }

  const rows = (data ?? []) as MoverRow[];

  // Sanity cap: filter extreme outliers (ETFs, data errors).
  // A legitimate equity rarely moves >300% in any period tracked here.
  const sane = rows.filter((r) => Math.abs(r.return_pct) <= 300);

  const gainers = sane
    .filter((r) => r.return_pct >= 0)
    .sort((a, b) => b.return_pct - a.return_pct)
    .slice(0, limit);

  const losers = sane
    .filter((r) => r.return_pct < 0)
    .sort((a, b) => a.return_pct - b.return_pct)
    .slice(0, limit);

  const as_of = gainers[0]?.end_date ?? losers[0]?.end_date ?? null;

  return jsonOk({ gainers, losers, period_days, as_of }, { cache: "live" });
}
