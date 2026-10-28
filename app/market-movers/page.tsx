"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import InfoTooltip from "@/components/InfoTooltip";
import { DISCLAIMER_SHORT } from "@/lib/disclaimer";

// ─── Types ────────────────────────────────────────────────────────────────────

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

type Period = "1w" | "1m" | "3m" | "6m" | "ytd" | "1y";

const PERIODS: { key: Period; label: string }[] = [
  { key: "1w",  label: "1 Week"  },
  { key: "1m",  label: "1 Month" },
  { key: "3m",  label: "3 Months"},
  { key: "6m",  label: "6 Months"},
  { key: "ytd", label: "YTD"     },
  { key: "1y",  label: "1 Year"  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(v: number): string {
  const abs  = Math.abs(v).toFixed(2);
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${abs}%`;
}

function fmtPrice(v: number): string {
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortName(raw: string): string {
  return raw
    .replace(/\s+(Limited|Ltd\.?|Inc\.?|Corporation|Industries|Company|Services?|Enterprise[s]?)\b.*$/i, "")
    .trim()
    .slice(0, 28);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

// ─── Mover card row ───────────────────────────────────────────────────────────

function MoverRow({
  row, rank, side,
}: { row: MoverRow; rank: number; side: "gainer" | "loser" }) {
  const isGain = side === "gainer";
  const pctColor = isGain ? "text-core-teal" : "text-core-negative";

  return (
    <Link
      href={`/company/${encodeURIComponent(row.ticker)}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-core-surface transition-colors group border-b border-core-line last:border-0"
    >
      {/* Rank */}
      <span className="text-[12px] text-core-muted tabular-nums w-5 shrink-0 text-right">
        {rank}
      </span>

      {/* Company */}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-core-ink group-hover:text-core-pink leading-tight truncate">
          {shortName(row.company_name)}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-core-muted tabular-nums">{row.ticker}</span>
          {row.sector && (
            <>
              <span className="text-core-line">·</span>
              <span className="text-[10px] text-core-muted truncate">{row.sector}</span>
            </>
          )}
        </div>
      </div>

      {/* Price + return */}
      <div className="text-right shrink-0">
        <div className={`text-[14px] font-bold tabular-nums ${pctColor}`}>
          {fmtPct(row.return_pct)}
        </div>
        <div className="text-[10px] text-core-muted tabular-nums mt-0.5">
          {fmtPrice(row.end_price)}
        </div>
      </div>
    </Link>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-px border border-core-line rounded-xl overflow-hidden">
      {[...Array(10)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
          <div className="w-5 h-3 bg-core-line rounded shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-36 bg-core-line rounded" />
            <div className="h-2.5 w-20 bg-core-line rounded" />
          </div>
          <div className="text-right space-y-1.5 shrink-0">
            <div className="h-4 w-14 bg-core-line rounded" />
            <div className="h-2.5 w-16 bg-core-line rounded ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Sector filter ────────────────────────────────────────────────────────────

function SectorFilter({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen]   = useState(false);
  const [sectors, setSectors] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/sectors?quarter=" + encodeURIComponent(
      process.env.NEXT_PUBLIC_DEFAULT_QUARTER || "Q2 FY27"
    ))
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && j.data?.sectors) {
          const names: string[] = j.data.sectors.map((s: { sector: string }) => s.sector).sort();
          setSectors(names);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!sectors.length) return null;

  const label = value || "All sectors";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 border border-core-line rounded-lg text-[12px] font-medium text-core-ink hover:border-core-ink transition-colors"
      >
        {label}
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden
          className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-52 bg-white border border-core-line rounded-lg shadow-lg py-1 z-20 max-h-72 overflow-y-auto">
          <button
            onClick={() => { onChange(""); setOpen(false); }}
            className={`w-full text-left px-4 py-2 text-[12px] font-medium transition-colors ${
              !value ? "text-core-pink bg-core-pink/5" : "text-core-ink hover:bg-core-surface"
            }`}
          >
            All sectors
          </button>
          {sectors.map((s) => (
            <button
              key={s}
              onClick={() => { onChange(s); setOpen(false); }}
              className={`w-full text-left px-4 py-2 text-[12px] font-medium transition-colors ${
                value === s ? "text-core-pink bg-core-pink/5" : "text-core-ink hover:bg-core-surface"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarketMoversPage() {
  const [period,  setPeriod]  = useState<Period>("1m");
  const [sector,  setSector]  = useState("");
  const [gainers, setGainers] = useState<MoverRow[]>([]);
  const [losers,  setLosers]  = useState<MoverRow[]>([]);
  const [asOf,    setAsOf]    = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(
    (p: Period, s: string) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ period: p, limit: "20" });
      if (s) params.set("sector", s);
      fetch(`/api/market-movers?${params}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.ok) {
            setGainers(j.data.gainers ?? []);
            setLosers(j.data.losers  ?? []);
            setAsOf(j.data.as_of ?? null);
          } else {
            setError(j.error ?? "Failed to load data");
          }
        })
        .catch(() => setError("Network error"))
        .finally(() => setLoading(false));
    },
    []
  );

  useEffect(() => { load(period, sector); }, [period, sector, load]);

  const PERIOD_LABEL = PERIODS.find((p) => p.key === period)?.label ?? period;

  return (
    <div className="container-core py-8 md:py-12 pb-20">
      {/* ── Masthead ── */}
      <section className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b border-core-line pb-6 mb-6">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-core-muted font-semibold">
            Corporate Earnings Dashboard
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tightest mt-1">
            Market Movers
            <span className="inline-block align-middle ml-2 -translate-y-0.5">
              <InfoTooltip text={DISCLAIMER_SHORT} size="md" />
            </span>
          </h1>
          <p className="text-[13px] text-core-muted mt-2 max-w-xl leading-snug">
            Top gainers and losers across NSE &amp; BSE — adjusted closing price returns.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <SectorFilter value={sector} onChange={setSector} />
        </div>
      </section>

      {/* ── Period pills ── */}
      <div className="flex flex-wrap gap-2 mb-6">
        {PERIODS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            className={`px-3.5 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
              period === key
                ? "bg-core-ink text-white border-core-ink"
                : "border-core-line text-core-muted hover:border-core-ink hover:text-core-ink"
            }`}
          >
            {label}
          </button>
        ))}
        {asOf && !loading && (
          <span className="ml-auto self-center text-[11px] text-core-muted tabular-nums">
            As of {fmtDate(asOf)}
          </span>
        )}
      </div>

      {/* ── Error ── */}
      {error ? (
        <div className="py-16 text-center text-core-negative text-[14px]">{error}</div>
      ) : null}

      {/* ── Two-column grid ── */}
      {!error && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Gainers */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-sm bg-core-teal shrink-0" />
              <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-core-ink">
                Top Gainers
              </h2>
              <span className="text-[11px] text-core-muted ml-1">· {PERIOD_LABEL}</span>
            </div>
            {loading ? (
              <Skeleton />
            ) : gainers.length === 0 ? (
              <p className="text-[13px] text-core-muted italic py-8 text-center border border-core-line rounded-xl">
                No gainers data for this period.
              </p>
            ) : (
              <div className="border border-core-line rounded-xl overflow-hidden">
                {gainers.map((r, i) => (
                  <MoverRow key={r.ticker} row={r} rank={i + 1} side="gainer" />
                ))}
              </div>
            )}
          </div>

          {/* Losers */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-sm bg-core-negative shrink-0" />
              <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-core-ink">
                Top Losers
              </h2>
              <span className="text-[11px] text-core-muted ml-1">· {PERIOD_LABEL}</span>
            </div>
            {loading ? (
              <Skeleton />
            ) : losers.length === 0 ? (
              <p className="text-[13px] text-core-muted italic py-8 text-center border border-core-line rounded-xl">
                No losers data for this period.
              </p>
            ) : (
              <div className="border border-core-line rounded-xl overflow-hidden">
                {losers.map((r, i) => (
                  <MoverRow key={r.ticker} row={r} rank={i + 1} side="loser" />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Data note ── */}
      {!loading && !error && (gainers.length > 0 || losers.length > 0) && (
        <p className="mt-8 text-[11px] text-core-muted leading-relaxed">
          Returns based on adjusted closing prices from Yahoo Finance via NSE/BSE.
          Split and bonus-adjusted. Updated each weekday by 4:30 PM IST.{" "}
          {sector ? `Showing ${sector} sector only. ` : ""}
          Past returns do not indicate future performance.
        </p>
      )}
    </div>
  );
}
