"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Legend,
} from "recharts";
import { formatINR, formatYoY, pctToneClass } from "@/lib/format";

// ── brand-safe palette: 5 distinct colours that look fine on white ────────
const COLORS = ["#E8365D", "#17AB8C", "#0A0A0A", "#F59E0B", "#6366F1"];
const COMPANY_COLOR = (i: number) => COLORS[i % COLORS.length];

// ── types ─────────────────────────────────────────────────────────────────
interface QRow {
  ticker: string;
  quarter_label: string;
  quarter_end_date: string;
  revenue: number | null;
  net_profit: number | null;
  operating_profit: number | null;
  eps: number | null;
  revenue_yoy: number | null;
  profit_yoy: number | null;
  source: string;
  data_quality_status: string;
}

interface CompanyData {
  company: {
    ticker: string; company_name: string;
    sector: string | null; industry: string | null; exchange: string;
  };
  quarters: QRow[];
}

type Metric = "revenue" | "net_profit" | "operating_profit" | "eps";
type View   = "chart" | "table";

const METRIC_LABELS: Record<Metric, string> = {
  revenue:           "Revenue",
  net_profit:        "Net Profit",
  operating_profit:  "Operating Profit",
  eps:               "EPS (₹)",
};

// ── search helper (simple typeahead) ────────────────────────────────────
interface SearchResult {
  ticker: string; company_name: string; sector: string | null;
}

function CompanyPicker({
  onAdd, disabledTickers,
}: {
  onAdd: (t: SearchResult) => void;
  disabledTickers: string[];
}) {
  const [q, setQ]           = useState("");
  const [hits, setHits]     = useState<SearchResult[]>([]);
  const debounce            = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef            = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!q.trim()) { setHits([]); return; }
    debounce.current = setTimeout(() => {
      fetch(`/api/companies?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((j) => j.ok && setHits((j.data ?? []).slice(0, 7)))
        .catch(() => setHits([]));
    }, 180);
  }, [q]);

  return (
    <div className="relative w-full max-w-sm">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-core-muted pointer-events-none">
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12.5 12.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Add a company…"
          className="w-full bg-white border border-core-line pl-9 pr-3 py-2.5 text-sm rounded-md focus:outline-none focus:border-core-ink focus:ring-2 focus:ring-core-pink/20"
        />
      </div>
      {hits.length > 0 && (
        <ul className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-core-line rounded-md shadow-lg max-h-72 overflow-auto">
          {hits.map((c) => {
            const disabled = disabledTickers.includes(c.ticker);
            return (
              <li key={c.ticker}>
                <button
                  disabled={disabled}
                  onClick={() => { onAdd(c); setQ(""); setHits([]); }}
                  className={`w-full text-left px-4 py-2.5 border-b border-core-line last:border-none text-sm transition
                    ${disabled
                      ? "opacity-40 cursor-not-allowed bg-core-surface"
                      : "hover:bg-core-surface"}`}
                >
                  <div className="font-semibold tracking-tightest">{c.company_name}</div>
                  <div className="text-[11px] text-core-muted mt-0.5">
                    {c.ticker} · {c.sector ?? "—"}
                    {disabled ? " · already added" : ""}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── chart: multi-line per company ─────────────────────────────────────────
function CompareChart({
  data, metric, companies,
}: {
  data: ChartRow[];
  metric: Metric;
  companies: CompanyData[];
}) {
  const isEps = metric === "eps";
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="#eee" vertical={false} />
          <XAxis
            dataKey="quarter_label"
            tick={{ fontSize: 10, fill: "#6B6B6B" }}
            tickLine={false}
            axisLine={{ stroke: "#e5e5e5" }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#6B6B6B" }}
            tickLine={false}
            axisLine={{ stroke: "#e5e5e5" }}
            tickFormatter={(v) =>
              isEps ? `₹${v}` : formatINR(v, { precision: 0 })
            }
            width={isEps ? 48 : 72}
          />
          <Tooltip
            contentStyle={{ borderRadius: 4, border: "1px solid #e5e5e5", fontSize: 12 }}
            formatter={(v: any, name: string) => [
              isEps ? `₹${Number(v).toFixed(2)}` : formatINR(Number(v)),
              name,
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            formatter={(value) => value}
          />
          {companies.map((co, idx) => (
            <Line
              key={co.company.ticker}
              type="monotone"
              dataKey={co.company.ticker}
              name={co.company.company_name}
              stroke={COMPANY_COLOR(idx)}
              strokeWidth={2}
              dot={{ r: 3, fill: COMPANY_COLOR(idx) }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── data shape for the chart ──────────────────────────────────────────────
interface ChartRow {
  quarter_label: string;
  [ticker: string]: number | null | string;
}

function buildChartData(companies: CompanyData[], metric: Metric): ChartRow[] {
  // Collect all unique quarter labels in chronological order.
  const labelSet = new Set<string>();
  const labelDate: Record<string, string> = {};
  for (const co of companies) {
    for (const q of co.quarters) {
      labelSet.add(q.quarter_label);
      labelDate[q.quarter_label] = q.quarter_end_date;
    }
  }
  const labels = [...labelSet].sort((a, b) =>
    (labelDate[a] ?? "").localeCompare(labelDate[b] ?? "")
  );

  return labels.map((label) => {
    const row: ChartRow = { quarter_label: label };
    for (const co of companies) {
      const q = co.quarters.find((r) => r.quarter_label === label);
      row[co.company.ticker] = q?.[metric] ?? null;
    }
    return row;
  });
}

// ── table view ────────────────────────────────────────────────────────────
function CompareTable({
  companies, metric,
}: {
  companies: CompanyData[];
  metric: Metric;
}) {
  const isEps = metric === "eps";

  // All quarter labels, newest first.
  const labelSet = new Set<string>();
  const labelDate: Record<string, string> = {};
  for (const co of companies) {
    for (const q of co.quarters) {
      labelSet.add(q.quarter_label);
      labelDate[q.quarter_label] = q.quarter_end_date;
    }
  }
  const labels = [...labelSet]
    .sort((a, b) => (labelDate[b] ?? "").localeCompare(labelDate[a] ?? ""));

  return (
    <div className="card overflow-x-auto">
      <table className="data-table" style={{ minWidth: `${200 + companies.length * 160}px` }}>
        <thead>
          <tr>
            <th>Quarter</th>
            {companies.map((co, idx) => (
              <th
                key={co.company.ticker}
                className="text-right"
                style={{ color: COMPANY_COLOR(idx) }}
              >
                {co.company.company_name.length > 20
                  ? co.company.ticker.replace(/\.(NS|BO)$/, "")
                  : co.company.company_name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label) => (
            <tr key={label}>
              <td className="font-semibold tabular-nums">{label}</td>
              {companies.map((co) => {
                const q = co.quarters.find((r) => r.quarter_label === label);
                const val = q?.[metric] ?? null;
                const yoy =
                  metric === "revenue"
                    ? q?.revenue_yoy
                    : metric === "net_profit"
                    ? q?.profit_yoy
                    : null;
                const sourceLabels: Record<string, string> = {
                  nse: "NSE", bse: "BSE", bse_pdf: "BSE PDF",
                  screener: "Screener", yahoo: "Yahoo",
                };
                const srcLabel = q ? (sourceLabels[q.source] ?? q.source) : null;
                const isPartial = q?.data_quality_status === "partial";
                const isMissing = q?.data_quality_status === "missing";
                return (
                  <td
                    key={co.company.ticker}
                    className={`text-right tabular-nums${isMissing ? " opacity-50" : ""}`}
                  >
                    <div className="font-semibold">
                      {val == null
                        ? "—"
                        : isEps
                        ? `₹${val.toFixed(2)}`
                        : formatINR(val)}
                    </div>
                    {yoy !== undefined && yoy !== null ? (
                      <div className={`text-[11px] ${pctToneClass(yoy)}`}>
                        {formatYoY(yoy)}
                      </div>
                    ) : null}
                    {srcLabel && (
                      <div className={`text-[9px] font-semibold uppercase tracking-[0.08em] mt-0.5 ${isPartial || isMissing ? "text-amber-600" : "text-core-muted"}`}>
                        {srcLabel}{isPartial ? " ·partial" : ""}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────
export default function ComparePage() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [companies, setCompanies] = useState<CompanyData[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [metric,    setMetric]    = useState<Metric>("revenue");
  const [view,      setView]      = useState<View>("chart");

  // Read tickers from URL on mount.
  const tickersFromUrl = searchParams.get("tickers") ?? "";

  const updateUrl = useCallback(
    (tickers: string[]) => {
      const params = new URLSearchParams();
      if (tickers.length) params.set("tickers", tickers.join(","));
      router.replace(`/compare?${params.toString()}`, { scroll: false });
    },
    [router]
  );

  // Fetch data whenever URL tickers change.
  useEffect(() => {
    const tickers = tickersFromUrl
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!tickers.length) { setCompanies([]); return; }

    setLoading(true);
    fetch(`/api/compare?tickers=${encodeURIComponent(tickers.join(","))}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setCompanies(j.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tickersFromUrl]);

  const selectedTickers = companies.map((c) => c.company.ticker);

  const addCompany = (c: SearchResult) => {
    if (selectedTickers.includes(c.ticker)) return;
    updateUrl([...selectedTickers, c.ticker]);
  };

  const removeCompany = (ticker: string) => {
    updateUrl(selectedTickers.filter((t) => t !== ticker));
  };

  const chartData = buildChartData(companies, metric);

  return (
    <div className="container-core py-8 md:py-12 space-y-8">
      {/* Page header */}
      <section className="border-b border-core-line pb-6">
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tightest leading-[1.05]">
          Company Comparison Lab
        </h1>
        <p className="mt-3 text-sm text-core-muted max-w-2xl">
          Compare quarterly revenue, profit and EPS for up to 5 listed companies
          side by side. Add companies below and switch between chart and table views.
        </p>
      </section>

      {/* Company selector row */}
      <section className="flex flex-wrap items-start gap-3">
        {/* Chips for selected companies */}
        {companies.map((co, idx) => (
          <div
            key={co.company.ticker}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium"
            style={{ borderColor: COMPANY_COLOR(idx), color: COMPANY_COLOR(idx) }}
          >
            <span className="max-w-[160px] truncate">{co.company.company_name}</span>
            <button
              onClick={() => removeCompany(co.company.ticker)}
              className="shrink-0 opacity-70 hover:opacity-100 transition"
              aria-label={`Remove ${co.company.company_name}`}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}

        {/* Add company picker */}
        {selectedTickers.length < 5 && (
          <CompanyPicker onAdd={addCompany} disabledTickers={selectedTickers} />
        )}
      </section>

      {/* Empty state */}
      {companies.length === 0 && !loading && (
        <div className="card p-10 text-center text-core-muted text-sm">
          <div className="text-2xl mb-3">↑</div>
          Search for a company above to start comparing. You can add up to 5 companies.
        </div>
      )}

      {loading && (
        <div className="card p-8 text-sm text-core-muted text-center">Loading…</div>
      )}

      {companies.length > 0 && !loading && (
        <>
          {/* Controls: metric + view toggle */}
          <section className="flex flex-wrap items-center justify-between gap-3">
            {/* Metric tabs */}
            <div className="flex gap-1 flex-wrap">
              {(Object.entries(METRIC_LABELS) as [Metric, string][]).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  className={`px-3 py-1.5 rounded text-xs font-semibold transition
                    ${metric === m
                      ? "bg-core-ink text-white"
                      : "border border-core-line text-core-muted hover:text-core-ink hover:border-core-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* View toggle */}
            <div className="flex gap-1 border border-core-line rounded overflow-hidden text-xs font-semibold">
              <button
                onClick={() => setView("chart")}
                className={`px-3 py-1.5 transition
                  ${view === "chart" ? "bg-core-ink text-white" : "text-core-muted hover:text-core-ink"}`}
              >
                Chart
              </button>
              <button
                onClick={() => setView("table")}
                className={`px-3 py-1.5 transition
                  ${view === "table" ? "bg-core-ink text-white" : "text-core-muted hover:text-core-ink"}`}
              >
                Table
              </button>
            </div>
          </section>

          {/* Chart or Table */}
          <section className="card p-5 md:p-6">
            <h2 className="text-lg font-bold tracking-tightest mb-4">
              {METRIC_LABELS[metric]} — quarterly trend
            </h2>

            {view === "chart" ? (
              <CompareChart data={chartData} metric={metric} companies={companies} />
            ) : (
              <CompareTable companies={companies} metric={metric} />
            )}
          </section>

          {/* Company metadata cards */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {companies.map((co, idx) => {
              const latest = co.quarters[co.quarters.length - 1];
              return (
                <div
                  key={co.company.ticker}
                  className="card p-4 border-t-2"
                  style={{ borderTopColor: COMPANY_COLOR(idx) }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-sm tracking-tightest truncate">
                        {co.company.company_name}
                      </div>
                      <div className="text-[11px] text-core-muted mt-0.5">
                        {co.company.ticker} · {co.company.sector ?? "—"}
                      </div>
                    </div>
                    <a
                      href={`/company/${encodeURIComponent(co.company.ticker)}`}
                      className="shrink-0 text-[11px] text-core-muted hover:text-core-pink"
                    >
                      View details & filings →
                    </a>
                  </div>

                  {latest ? (
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <Stat
                        label="Latest quarter"
                        value={latest.quarter_label}
                      />
                      <Stat
                        label="Revenue"
                        value={formatINR(latest.revenue)}
                        sub={
                          latest.revenue_yoy != null
                            ? <span className={pctToneClass(latest.revenue_yoy)}>{formatYoY(latest.revenue_yoy)} YoY</span>
                            : null
                        }
                      />
                      <Stat
                        label="Net profit"
                        value={formatINR(latest.net_profit)}
                        sub={
                          latest.profit_yoy != null
                            ? <span className={pctToneClass(latest.profit_yoy)}>{formatYoY(latest.profit_yoy)} YoY</span>
                            : null
                        }
                      />
                      <Stat
                        label="EPS"
                        value={latest.eps != null ? `₹${latest.eps.toFixed(2)}` : "—"}
                      />
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-core-muted">No quarterly data yet</div>
                  )}
                </div>
              );
            })}
          </section>

          {/* Share link hint */}
          <section className="text-[11px] text-core-muted">
            This comparison is shareable — copy the URL to send it to someone.
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label, value, sub,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-core-muted">{label}</div>
      <div className="font-semibold tabular-nums mt-0.5">{value}</div>
      {sub ? <div className="mt-0.5">{sub}</div> : null}
    </div>
  );
}
