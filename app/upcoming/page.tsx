"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import InfoTooltip from "@/components/InfoTooltip";
import { formatDate } from "@/lib/format";
import { simplifyPurpose } from "@/lib/purpose";
import { DISCLAIMER_SHORT } from "@/lib/disclaimer";

interface Row {
  company_name: string;
  ticker: string;
  sector: string | null;
  next_result_date: string;
  purpose?: string | null;
}

// Bellwethers — same curated list used elsewhere. Highlighted at the top
// of /upcoming so readers know which big-cap filings are still to come.
const BELLWETHERS = new Set([
  "RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "INFY.NS", "ICICIBANK.NS",
  "ITC.NS", "HINDUNILVR.NS", "SBIN.NS", "BHARTIARTL.NS", "LT.NS",
  "BAJFINANCE.NS", "HCLTECH.NS", "KOTAKBANK.NS", "MARUTI.NS", "ASIANPAINT.NS"
]);

export default function UpcomingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    fetch("/api/upcoming").then((r) => r.json()).then((j) => j.ok && setRows(j.data));
  }, []);

  // Group by date so the list reads like a calendar (most-imminent first).
  const groups = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const byDate = new Map<string, Row[]>();
    for (const r of rows) {
      const arr = byDate.get(r.next_result_date) ?? [];
      arr.push(r);
      byDate.set(r.next_result_date, arr);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, items]) => {
        const t = new Date(date + "T00:00:00").getTime();
        const days = Math.round((t - today.getTime()) / 86_400_000);
        const rel = days === 0 ? "Today"
          : days === 1 ? "Tomorrow"
          : days > 0   ? `In ${days} days`
          : `${-days}d ago`;
        return { date, rel, days, items: items.sort((a, b) => a.company_name.localeCompare(b.company_name)) };
      });
  }, [rows]);

  // Headline stats for the hero: counts in today / this week / this month.
  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekEnd  = new Date(today.getTime() + 6  * 86_400_000);
    const monthEnd = new Date(today.getTime() + 29 * 86_400_000);
    const uniqueOn = (pred: (t: number) => boolean) => {
      const s = new Set<string>();
      for (const r of rows) {
        const t = new Date(r.next_result_date + "T00:00:00").getTime();
        if (pred(t)) s.add(r.ticker);
      }
      return s.size;
    };
    return {
      todayCount:  uniqueOn((t) => t === today.getTime()),
      weekCount:   uniqueOn((t) => t >= today.getTime() && t <= weekEnd.getTime()),
      monthCount:  uniqueOn((t) => t >= today.getTime() && t <= monthEnd.getTime()),
    };
  }, [rows]);

  // Bellwethers still pending — filter the list + dedupe by ticker.
  const bellwethersPending = useMemo(() => {
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const r of rows) {
      if (BELLWETHERS.has(r.ticker) && !seen.has(r.ticker)) {
        seen.add(r.ticker);
        out.push(r);
      }
    }
    return out.sort((a, b) => a.next_result_date.localeCompare(b.next_result_date));
  }, [rows]);

  return (
    <div className="container-core py-8 md:py-10 space-y-8 md:space-y-10">
      {/* ============ MASTHEAD ============ */}
      <section className="flex items-start justify-between gap-4 flex-wrap border-b border-core-line pb-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-x-2 text-[10px] uppercase tracking-[0.14em] text-core-muted mb-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-core-pink" />
            <span>Earnings tracker</span>
            <span className="text-core-line-2">/</span>
            <span className="text-core-ink font-semibold">Upcoming</span>
          </div>
          <h1 className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold tracking-tightest leading-[1.05] flex items-baseline gap-2">
            <span>Upcoming results</span>
            <InfoTooltip text={DISCLAIMER_SHORT} size="md" />
          </h1>
          <p className="text-core-muted mt-3 max-w-2xl text-[14px]">
            Companies with a scheduled earnings meeting. Results typically file after
            market hours — <Link href="/" className="text-core-pink hover:underline">check the dashboard →</Link> once numbers land.
          </p>
        </div>
        <div className="flex items-baseline gap-5 md:gap-7 text-right shrink-0">
          <StatCell n={stats.todayCount}  label="today" />
          <StatCell n={stats.weekCount}   label="this week" />
          <StatCell n={stats.monthCount}  label="this month" accent />
        </div>
      </section>

      {/* ============ BELLWETHERS PENDING ============ */}
      {bellwethersPending.length > 0 ? (
        <section>
          <header className="flex items-baseline justify-between gap-3 mb-4">
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] md:text-[11px] uppercase tracking-[0.22em] text-core-muted font-semibold">
                Big names pending
              </span>
              <span className="text-[12px] text-core-muted">· bellwethers still to report</span>
            </div>
            <span className="text-[11px] text-core-muted tabular-nums">
              {bellwethersPending.length} pending
            </span>
          </header>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
            {bellwethersPending.map((r) => (
              <Link
                key={r.ticker}
                href={`/company/${encodeURIComponent(r.ticker)}`}
                className="group block border border-core-line bg-white p-3 hover:border-core-ink transition-colors"
              >
                <div className="text-[13px] font-semibold tracking-tightest leading-tight truncate group-hover:text-core-pink transition-colors">
                  {r.company_name.replace(/ Limited$| Ltd\.?$| Industries$/i, "").trim()}
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-core-muted flex items-center gap-1.5">
                  <span className="inline-block w-1 h-1 bg-core-pink rounded-full" />
                  {formatDate(r.next_result_date)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ============ CALENDAR ============ */}
      {groups.length === 0 ? (
        <div className="card p-10 text-center text-sm text-core-muted">
          No announcement dates scheduled.
        </div>
      ) : (
        <section className="space-y-8">
          <header className="flex items-baseline gap-3">
            <span className="text-[10px] md:text-[11px] uppercase tracking-[0.22em] text-core-muted font-semibold">
              Full schedule
            </span>
            <span className="text-[12px] text-core-muted">· grouped by date</span>
          </header>
          {groups.map((g) => (
            <div key={g.date}>
              <div className="flex items-baseline justify-between pb-2 mb-3 border-b border-core-line">
                <h2 className="text-lg font-semibold tracking-tightest">
                  {formatDate(g.date)}
                  <span className={`ml-3 text-[11px] uppercase tracking-[0.14em] font-normal ${g.days === 0 ? "text-core-pink font-semibold" : "text-core-muted"}`}>
                    {g.rel}
                  </span>
                </h2>
                <span className="text-xs text-core-muted tabular-nums">
                  {g.items.length} {g.items.length === 1 ? "company" : "companies"}
                </span>
              </div>
              <div className="card overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Ticker</th>
                      <th>Sector</th>
                      <th>Purpose</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((r, i) => (
                      <tr key={`${r.ticker}-${i}`}>
                        <td>
                          <Link href={`/company/${encodeURIComponent(r.ticker)}`} className="font-semibold hover:text-core-pink">
                            {r.company_name}
                          </Link>
                        </td>
                        <td className="text-sm text-core-muted tabular-nums">{r.ticker}</td>
                        <td className="text-sm text-core-muted">{r.sector ?? "—"}</td>
                        <td className="text-sm text-core-ink max-w-[420px]" title={r.purpose ?? undefined}>
                          {simplifyPurpose(r.purpose, r.next_result_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// Hero stat pair — used in the upcoming masthead.
function StatCell({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div>
      <div className={`text-[22px] md:text-[28px] font-bold tabular-nums tracking-tightest leading-none ${accent ? "text-core-pink" : "text-core-ink"}`}>
        {n}
      </div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-core-muted mt-1">{label}</div>
    </div>
  );
}
