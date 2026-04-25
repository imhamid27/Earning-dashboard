"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SectorComparison from "@/components/SectorComparison";
import EmptyState from "@/components/EmptyState";
import InfoTooltip from "@/components/InfoTooltip";
import JsonLd from "@/components/JsonLd";
import { formatINR, formatPct, formatYoY, pctToneClass } from "@/lib/format";
import { DISCLAIMER_SHORT } from "@/lib/disclaimer";
import { siteUrl } from "@/lib/site";

interface SectorRow {
  sector: string;
  companies_reported: number;
  total_revenue: number;
  total_net_profit: number;
  revenue_yoy: number | null;
  profit_yoy: number | null;
}

interface CompanyRow {
  ticker: string;
  company_name: string;
  sector: string | null;
  quarter_label: string;
  quarter_end_date: string;
  revenue: number | null;
  net_profit: number | null;
  revenue_yoy?: number | null;
  profit_yoy?: number | null;
}

// AEO: breadcrumb schema — static, built at module load.
const BASE = siteUrl();
const SECTORS_BREADCRUMB = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Dashboard", "item": `${BASE}/` },
    { "@type": "ListItem", "position": 2, "name": "Sector view", "item": `${BASE}/sectors` }
  ]
};

export default function SectorsPage() {
  const [quarters, setQuarters] = useState<string[]>([]);
  const [quarter, setQuarter] = useState<string | null>(null);
  const [data, setData] = useState<{ sectors: SectorRow[] } | null>(null);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [activeSector, setActiveSector] = useState<string | null>(null);

  // Pick default quarter: most recent with ≥ 100 reporters (real coverage).
  useEffect(() => {
    Promise.all([
      fetch("/api/quarters").then((r) => r.json()),
      fetch("/api/best-quarter?min=100").then((r) => r.json())
    ]).then(([qs, best]) => {
      if (qs.ok) setQuarters(qs.data);
      const pick = best?.ok && best.data?.best?.quarter_label;
      if (pick) setQuarter(pick);
      else if (qs.ok && qs.data[0]) setQuarter(qs.data[0]);
    });
  }, []);

  // Sector aggregates
  useEffect(() => {
    if (!quarter) return;
    fetch(`/api/sectors?quarter=${encodeURIComponent(quarter)}`)
      .then((r) => r.json())
      .then((j) => j.ok && setData(j.data));
  }, [quarter]);

  // Companies for the selected quarter — for the sector drilldown below.
  useEffect(() => {
    if (!quarter) return;
    fetch(`/api/dashboard?quarter=${encodeURIComponent(quarter)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          const rows = (j.data?.rows ?? [])
            .filter((r: any) => r.quarter_end_date)
            .map((r: any): CompanyRow => ({
              ticker: r.ticker,
              company_name: r.company_name,
              sector: r.sector,
              quarter_label: r.quarter_label,
              quarter_end_date: r.quarter_end_date,
              revenue: r.revenue,
              net_profit: r.net_profit,
              revenue_yoy: r.revenue_yoy ?? null,
              profit_yoy: r.profit_yoy ?? null
            }));
          setCompanies(rows);
        }
      });
  }, [quarter]);

  const bySector = useMemo(() => {
    const m = new Map<string, CompanyRow[]>();
    for (const c of companies) {
      const s = c.sector ?? "Other";
      if (!m.has(s)) m.set(s, []);
      m.get(s)!.push(c);
    }
    for (const arr of m.values()) arr.sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
    return m;
  }, [companies]);

  // Default activeSector to the top one as soon as data arrives.
  useEffect(() => {
    if (activeSector || !data?.sectors.length) return;
    setActiveSector(data.sectors[0].sector);
  }, [data, activeSector]);

  const sectorCompanies = activeSector ? (bySector.get(activeSector) ?? []) : [];

  return (
    <div className="container-core py-8 md:py-12 space-y-8">
      <JsonLd data={SECTORS_BREADCRUMB} />

      {/* Heading */}
      <section className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b border-core-line pb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-core-muted">Earnings Tracker</div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tightest mt-1">
            Sector view
            <span className="inline-block align-middle ml-2 -translate-y-0.5">
              <InfoTooltip text={DISCLAIMER_SHORT} size="md" />
            </span>
          </h1>
          <p className="text-core-muted mt-2 max-w-2xl text-sm">
            How India's sectors are growing — aggregated revenue and net profit,
            each quarter vs the same quarter last year.
          </p>
        </div>
        <label className="flex items-center gap-2.5 text-[10px] uppercase tracking-[0.14em] text-core-muted">
          Quarter
          <select
            value={quarter ?? ""}
            onChange={(e) => { setQuarter(e.target.value || null); setActiveSector(null); }}
            className="border border-core-line bg-white text-sm px-3 py-2 rounded-md normal-case text-core-ink font-semibold focus:outline-none focus:border-core-pink"
          >
            {quarters.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </label>
      </section>

      {/* Sector chart + aggregates table */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <header className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-y-1 mb-4">
            <h3 className="text-lg font-semibold tracking-tightest">
              Revenue growth by sector · {quarter ?? "—"}
            </h3>
            <span className="text-[10px] uppercase tracking-[0.14em] text-core-muted">
              Teal = growth · Red = contraction
            </span>
          </header>
          <SectorComparison rows={data?.sectors ?? []} metric="revenue_yoy" />
        </div>
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Sector</th>
                <th className="text-right">Cos</th>
                <th className="text-right">Revenue YoY</th>
              </tr>
            </thead>
            <tbody>
              {(data?.sectors ?? []).map((s) => (
                <tr
                  key={s.sector}
                  className={`cursor-pointer ${s.sector === activeSector ? "bg-core-surface" : ""}`}
                  onClick={() => setActiveSector(s.sector)}
                >
                  <td className="font-semibold">{s.sector}</td>
                  <td className="text-right tabular-nums">{s.companies_reported}</td>
                  <td className={`text-right tabular-nums font-semibold whitespace-nowrap ${pctToneClass(s.revenue_yoy)}`}>
                    {formatYoY(s.revenue_yoy)}
                  </td>
                </tr>
              ))}
              {(!data || data.sectors.length === 0) ? (
                <tr><td colSpan={3} className="text-center text-sm text-core-muted py-6">No sector data.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Totals table */}
      <section>
        <header className="flex items-baseline justify-between mb-3">
          <h2 className="text-xl font-bold tracking-tightest">Sector totals · {quarter ?? "—"}</h2>
        </header>
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Sector</th>
                <th className="text-right">Companies</th>
                <th className="text-right">Total revenue</th>
                <th className="text-right">Revenue YoY</th>
                <th className="text-right">Total net profit</th>
                <th className="text-right">Profit YoY</th>
              </tr>
            </thead>
            <tbody>
              {(data?.sectors ?? []).map((s) => (
                <tr key={s.sector}>
                  <td className="font-semibold">
                    <button
                      onClick={() => setActiveSector(s.sector)}
                      className="hover:text-core-pink"
                    >
                      {s.sector}
                    </button>
                  </td>
                  <td className="text-right tabular-nums">{s.companies_reported}</td>
                  <td className="text-right tabular-nums font-semibold">{formatINR(s.total_revenue)}</td>
                  <td className={`text-right tabular-nums font-semibold whitespace-nowrap ${pctToneClass(s.revenue_yoy)}`}>
                    {formatYoY(s.revenue_yoy)}
                  </td>
                  <td className="text-right tabular-nums font-semibold">{formatINR(s.total_net_profit)}</td>
                  <td className={`text-right tabular-nums font-semibold whitespace-nowrap ${pctToneClass(s.profit_yoy)}`}>
                    {formatYoY(s.profit_yoy)}
                  </td>
                </tr>
              ))}
              {(!data || data.sectors.length === 0) ? (
                <tr><td colSpan={6} className="text-center text-sm text-core-muted py-6">No data.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Drilldown — companies in the selected sector */}
      {activeSector ? (
        <section>
          <header className="flex items-baseline justify-between mb-3 border-b border-core-line pb-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-core-muted">Companies in sector</div>
              <h2 className="text-xl font-bold tracking-tightest mt-0.5">
                {activeSector}
                <span className="ml-3 text-sm font-normal text-core-muted">
                  {sectorCompanies.length} in {quarter ?? "—"}
                </span>
              </h2>
            </div>
          </header>
          {sectorCompanies.length === 0 ? (
            <EmptyState
              title={`No ${activeSector} filings for ${quarter}`}
              message="Try a more complete quarter using the dropdown above."
            />
          ) : (
            <div className="card overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">Rev YoY</th>
                    <th className="text-right">Net profit</th>
                    <th className="text-right">Profit YoY</th>
                  </tr>
                </thead>
                <tbody>
                  {sectorCompanies.map((c) => (
                    <tr key={c.ticker}>
                      <td>
                        <Link href={`/company/${encodeURIComponent(c.ticker)}`} className="font-semibold hover:text-core-pink">
                          {c.company_name}
                        </Link>
                        <div className="text-[11px] text-core-muted tabular-nums">{c.ticker}</div>
                      </td>
                      <td className="text-right tabular-nums font-semibold">{formatINR(c.revenue)}</td>
                      <td className={`text-right tabular-nums font-semibold whitespace-nowrap ${pctToneClass(c.revenue_yoy ?? null)}`}>
                        {formatYoY(c.revenue_yoy ?? null)}
                      </td>
                      <td className="text-right tabular-nums font-semibold">{formatINR(c.net_profit)}</td>
                      <td className={`text-right tabular-nums font-semibold whitespace-nowrap ${pctToneClass(c.profit_yoy ?? null)}`}>
                        {formatYoY(c.profit_yoy ?? null)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
