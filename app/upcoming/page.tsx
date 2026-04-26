"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import InfoTooltip from "@/components/InfoTooltip";
import JsonLd from "@/components/JsonLd";
import { formatDate } from "@/lib/format";
import { simplifyPurpose } from "@/lib/purpose";
import { DISCLAIMER_SHORT } from "@/lib/disclaimer";
import { siteUrl } from "@/lib/site";

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

// AEO: breadcrumb schema — static, built at module load.
const BASE = siteUrl();
const UPCOMING_BREADCRUMB = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Dashboard", "item": `${BASE}/` },
    { "@type": "ListItem", "position": 2, "name": "Upcoming results", "item": `${BASE}/upcoming` }
  ]
};

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
      <JsonLd data={UPCOMING_BREADCRUMB} />

      {/* ============ MASTHEAD ============
          On mobile: title + description get the full width; stats stack
          BELOW as a 3-column grid so neither crowds the other. On
          desktop: stats sit to the right as before. */}
      <section className="border-b border-core-line pb-6">
        <div className="flex items-center gap-x-2 text-[10px] uppercase tracking-[0.14em] text-core-muted mb-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-core-pink" />
          <span>Earnings tracker</span>
          <span className="text-core-line-2">/</span>
          <span className="text-core-ink font-semibold">Upcoming</span>
        </div>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 md:gap-6">
          <div className="flex-1 min-w-0">
            <h1 className="text-[clamp(1.85rem,4vw,2.85rem)] font-extrabold tracking-tightest leading-[1.05]">
              Upcoming results
              <span className="inline-block align-middle ml-2 -translate-y-0.5">
                <InfoTooltip text={DISCLAIMER_SHORT} size="md" />
              </span>
            </h1>
            <p className="text-core-muted mt-3 max-w-2xl text-[14px]">
              Companies with a scheduled earnings meeting. Results typically file after
              market hours — <Link href="/" className="text-core-pink hover:underline">check the dashboard →</Link> once numbers land.
            </p>
          </div>
          <div className="grid grid-cols-3 md:flex md:items-baseline gap-4 md:gap-7 md:text-right shrink-0 pt-2 md:pt-0 border-t md:border-0 border-core-line">
            <StatCell n={stats.todayCount}  label="today" />
            <StatCell n={stats.weekCount}   label="this week" />
            <StatCell n={stats.monthCount}  label="this month" accent />
          </div>
        </div>
      </section>

      {/* ============ BELLWETHERS PENDING ============ */}
      {bellwethersPending.length > 0 ? (
        <section>
          <header className="flex items-baseline justify-between gap-3 mb-4">
            <div className="flex items-baseline gap-3">
              <span className="text-[11px] md:text-[12px] uppercase tracking-[0.18em] text-core-ink font-bold">
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
            <span className="text-[11px] md:text-[12px] uppercase tracking-[0.18em] text-core-ink font-bold">
              Full schedule
            </span>
            <span className="text-[12px] text-core-muted">· grouped by date</span>
          </header>
          {groups.map((g) => {
            // Timing hint: results land either pre-market or post-market.
            // Show a readable context note on today's date group only.
            const istHour = Number(
              new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false,
              }).format(new Date())
            );
            const timingHint = g.days === 0
              ? istHour < 9  ? "Results expected before market open or post market"
                : istHour < 15 ? "Expected today — results typically after market close"
                : "Expected today (any time — markets closed)"
              : g.days === 1 ? "Expected tomorrow, typically after market close"
              : null;

            // Big names in this day's group
            const bigNames = g.items.filter((r) => BELLWETHERS.has(r.ticker));

            return (
              <div key={g.date}>
                <div className="pb-2 mb-3 border-b border-core-line">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h2 className="text-lg font-semibold tracking-tightest">
                        {formatDate(g.date)}
                      </h2>
                      <span className={`text-[11px] uppercase tracking-[0.14em] font-normal ${g.days === 0 ? "text-core-pink font-semibold" : "text-core-muted"}`}>
                        {g.rel}
                      </span>
                      {timingHint ? (
                        <span className="hidden sm:inline text-[11px] text-core-muted italic">· {timingHint}</span>
                      ) : null}
                    </div>
                    <span className="text-xs text-core-muted tabular-nums shrink-0">
                      {g.items.length} {g.items.length === 1 ? "company" : "companies"}
                    </span>
                  </div>
                  {bigNames.length > 0 ? (
                    <div className="mt-1 text-[11px] text-core-muted flex flex-wrap gap-x-2 gap-y-0.5">
                      <span className="font-semibold text-core-ink/60">Key:</span>
                      {bigNames.slice(0, 3).map((b, i) => (
                        <span key={b.ticker}>
                          {i > 0 ? <span className="text-core-line-2">·</span> : null}
                          <Link href={`/company/${encodeURIComponent(b.ticker)}`} className="font-semibold text-core-ink hover:text-core-pink ml-1">
                            {b.company_name.replace(/ Limited$| Ltd\.?$| Industries$/i, "").trim()}
                          </Link>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="card overflow-x-auto">
                  <table className="data-table" style={{ minWidth: "520px" }}>
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th className="hidden sm:table-cell">Ticker</th>
                        <th className="hidden sm:table-cell">Sector</th>
                        <th>Purpose</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((r, i) => (
                        <tr key={`${r.ticker}-${i}`}
                          className={BELLWETHERS.has(r.ticker) ? "bg-core-surface" : undefined}
                        >
                          <td>
                            <Link href={`/company/${encodeURIComponent(r.ticker)}`} className="font-semibold hover:text-core-pink whitespace-nowrap">
                              {r.company_name}
                            </Link>
                            {BELLWETHERS.has(r.ticker) ? (
                              <span className="ml-2 text-[9px] uppercase tracking-[0.14em] text-core-pink font-semibold">Key name</span>
                            ) : null}
                            {/* Show ticker + sector inline on mobile since those columns are hidden */}
                            <div className="sm:hidden text-[10px] text-core-muted mt-0.5 tabular-nums">
                              {r.ticker}{r.sector ? ` · ${r.sector}` : ""}
                            </div>
                          </td>
                          <td className="hidden sm:table-cell text-sm text-core-muted tabular-nums">{r.ticker}</td>
                          <td className="hidden sm:table-cell text-sm text-core-muted">{r.sector ?? "—"}</td>
                          <td className="text-sm text-core-ink max-w-[420px]" title={r.purpose ?? undefined}>
                            {simplifyPurpose(r.purpose, r.next_result_date)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
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
