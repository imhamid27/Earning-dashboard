"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { simplifyPurpose } from "@/lib/purpose";

interface Row {
  company_name: string;
  ticker: string;
  sector: string | null;
  next_result_date: string;
  purpose?: string | null;
}

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
        return { date, rel, items: items.sort((a, b) => a.company_name.localeCompare(b.company_name)) };
      });
  }, [rows]);

  return (
    <div className="container-core py-8 md:py-12 space-y-8">
      {/* Heading */}
      <section className="border-b border-core-line pb-6">
        <div className="text-[11px] uppercase tracking-[0.14em] text-core-muted">Earnings Tracker</div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tightest mt-1">Upcoming results</h1>
        <p className="text-core-muted mt-2 max-w-2xl text-sm">
          Companies with a scheduled earnings announcement. Results typically file
          after market hours — check back the next morning for the numbers.
        </p>
      </section>

      {groups.length === 0 ? (
        <div className="card p-10 text-center text-sm text-core-muted">
          No announcement dates scheduled.
        </div>
      ) : (
        <section className="space-y-8">
          {groups.map((g) => (
            <div key={g.date}>
              <div className="flex items-baseline justify-between pb-2 mb-3 border-b border-core-line">
                <h2 className="text-lg font-semibold tracking-tightest">
                  {formatDate(g.date)}
                  <span className="ml-3 text-[11px] uppercase tracking-[0.14em] text-core-muted font-normal">
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
