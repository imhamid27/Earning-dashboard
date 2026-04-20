import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { jsonOk, jsonError } from "@/lib/api";

// GET /api/upcoming
// Scheduled earnings announcements within the next 60 days.
// Prefers the BSE-scraped `announcement_events` table; falls back to the
// legacy `companies.next_result_date` column for companies without a feed.
export async function GET(_req: NextRequest) {
  const sb = supabaseServer();
  const today = new Date().toISOString().slice(0, 10);

  // Pull pending announcement events (announcement_events is populated from
  // exchange calendars; the internal `source` field is not surfaced in the
  // response).
  const { data: events, error: eErr } = await sb
    .from("announcement_events")
    .select("ticker,announcement_date,purpose,status,companies!inner(company_name,sector,is_active)")
    .gte("announcement_date", today)
    .eq("status", "pending")
    .eq("companies.is_active", true)
    .order("announcement_date", { ascending: true })
    .limit(500);
  if (eErr) return jsonError(eErr.message, 500);

  // Dedupe by (ticker, date). A company often has multiple rows for the
  // same meeting — we want one row per meeting in the output.
  const byKey = new Map<string, {
    ticker: string; company_name: string; sector: string | null;
    next_result_date: string; purpose: string | null;
  }>();
  for (const e of (events ?? []) as any[]) {
    const key = `${e.ticker}|${e.announcement_date}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ticker: e.ticker,
        company_name: e.companies?.company_name ?? e.ticker,
        sector: e.companies?.sector ?? null,
        next_result_date: e.announcement_date,
        purpose: e.purpose
      });
    } else if ((e.purpose?.length ?? 0) > (existing.purpose?.length ?? 0)) {
      // Prefer the longer, more informative purpose string.
      existing.purpose = e.purpose;
    }
  }
  const fromEvents = Array.from(byKey.values());

  // 2. pad with any company that has a manually-set next_result_date but
  //    no corresponding event row (useful for hand-curated additions).
  const tickersWithEvent = new Set(fromEvents.map((e) => e.ticker));
  const { data: manual, error: mErr } = await sb
    .from("companies")
    .select("company_name,ticker,sector,next_result_date")
    .gte("next_result_date", today)
    .order("next_result_date", { ascending: true })
    .limit(50);
  if (mErr) return jsonError(mErr.message, 500);
  const fromManual = (manual ?? [])
    .filter((c) => !tickersWithEvent.has(c.ticker))
    .map((c) => ({
      ticker: c.ticker,
      company_name: c.company_name,
      sector: c.sector,
      next_result_date: c.next_result_date!,
      purpose: null as string | null
    }));

  const combined = [...fromEvents, ...fromManual]
    .sort((a, b) => a.next_result_date.localeCompare(b.next_result_date));

  return jsonOk(combined);
}
