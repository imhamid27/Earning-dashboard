"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type MoverRow = {
  ticker: string;
  company_name: string;
  sector: string | null;
  end_price: number;
  start_price: number;
  return_pct: number;
};

type SectorRow = {
  sector: string;
  companies_reported: number;
  revenue_yoy: number | null;
  profit_yoy: number | null;
};

type QuarterSummary = {
  quarter: string;
  companies_reported: number;
  companies_tracked: number;
  avg_revenue_yoy: number | null;
  avg_profit_yoy: number | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(v: number | null, digits = 1): string {
  if (v == null) return "—";
  if (Math.abs(v) > 9.99) return v > 0 ? "+high" : "−high";
  const abs  = (Math.abs(v) * 100).toFixed(digits);
  const sign = v > 0 ? "+" : "−";
  return `${sign}${abs}%`;
}

function fmtStockPct(v: number): string {
  const abs  = Math.abs(v).toFixed(1);
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${abs}%`;
}

function shortName(raw: string): string {
  return raw
    .replace(/\s+(Limited|Ltd\.?|Inc\.?|Corporation|Industries|Company|Services?|Enterprise[s]?)\b.*$/i, "")
    .trim()
    .slice(0, 26);
}

function toneClass(v: number | null): string {
  if (v == null) return "text-core-muted";
  return v > 0 ? "text-core-teal" : "text-core-negative";
}

// Quarter label → short display: "Q2 FY27" → "Q2 FY27"
function qLabel(q: string): string { return q; }

// Fiscal quarters that fall in calendar 2026
const CALENDAR_2026_QUARTERS = ["Q4 FY26", "Q1 FY27", "Q2 FY27", "Q3 FY27"];

// ─── Stat tile ────────────────────────────────────────────────────────────────

function StatTile({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: "positive" | "negative" | "neutral" }) {
  const valClass =
    tone === "positive" ? "text-core-teal"
    : tone === "negative" ? "text-core-negative"
    : "text-core-ink";
  return (
    <div className="bg-white border border-core-line rounded-xl p-5">
      <div className="text-[10px] uppercase tracking-[0.2em] text-core-muted font-semibold mb-2">{label}</div>
      <div className={`text-[28px] md:text-[32px] font-extrabold tabular-nums tracking-tightest leading-none ${valClass}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-core-muted mt-1.5">{sub}</div>}
    </div>
  );
}

// ─── Mover mini-row ───────────────────────────────────────────────────────────

function MoverLine({ row, rank, side }: { row: MoverRow; rank: number; side: "gain" | "loss" }) {
  const color = side === "gain" ? "text-core-teal" : "text-core-negative";
  return (
    <Link
      href={`/company/${encodeURIComponent(row.ticker)}`}
      className="flex items-center gap-3 py-2.5 border-b border-core-line last:border-0 hover:bg-core-surface transition-colors group px-1"
    >
      <span className="text-[11px] text-core-muted w-4 text-right shrink-0 tabular-nums">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-core-ink group-hover:text-core-pink truncate leading-tight">
          {shortName(row.company_name)}
        </div>
        <div className="text-[10px] text-core-muted">{row.ticker}</div>
      </div>
      <span className={`text-[14px] font-bold tabular-nums shrink-0 ${color}`}>
        {fmtStockPct(row.return_pct)}
      </span>
    </Link>
  );
}

// ─── Quarter card ─────────────────────────────────────────────────────────────

function QuarterCard({ qs, isCurrent }: { qs: QuarterSummary; isCurrent: boolean }) {
  const pctReported =
    qs.companies_tracked > 0
      ? Math.round((qs.companies_reported / qs.companies_tracked) * 100)
      : null;

  return (
    <div className={`rounded-xl border p-5 relative ${
      isCurrent ? "border-core-pink bg-core-pink/5" : "border-core-line bg-white"
    }`}>
      {isCurrent && (
        <span className="absolute top-3 right-3 text-[9px] uppercase tracking-[0.18em] font-bold text-core-pink bg-core-pink/10 px-2 py-0.5 rounded-full">
          Live
        </span>
      )}
      <div className="text-[11px] uppercase tracking-[0.18em] text-core-muted font-semibold mb-1">
        {qLabel(qs.quarter)}
      </div>
      <div className="text-[22px] font-extrabold text-core-ink tabular-nums leading-none mb-3">
        {qs.companies_reported.toLocaleString()}
        <span className="text-[13px] font-medium text-core-muted ml-1">
          / {qs.companies_tracked.toLocaleString()} companies
        </span>
      </div>
      {pctReported != null && (
        <div className="h-1.5 rounded-full bg-core-line overflow-hidden mb-3">
          <div
            className="h-full bg-core-teal rounded-full transition-all"
            style={{ width: `${Math.min(pctReported, 100)}%` }}
          />
        </div>
      )}
      <div className="flex gap-4 text-[12px]">
        <div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-core-muted mb-0.5">Rev YoY</div>
          <div className={`font-bold ${toneClass(qs.avg_revenue_yoy)}`}>
            {fmtPct(qs.avg_revenue_yoy)}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-core-muted mb-0.5">Profit YoY</div>
          <div className={`font-bold ${toneClass(qs.avg_profit_yoy)}`}>
            {fmtPct(qs.avg_profit_yoy)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sector row ───────────────────────────────────────────────────────────────

function SectorScoreRow({ s, maxAbs }: { s: SectorRow; maxAbs: number }) {
  const pv = s.profit_yoy;
  const rv = s.revenue_yoy;
  const barWidth = pv != null && Math.abs(pv) <= 9.99 && maxAbs > 0
    ? Math.round((Math.abs(pv) / maxAbs) * 100)
    : pv != null ? 100 : 0;
  const isPos = pv != null && pv > 0;

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-core-line last:border-0">
      <div className="w-40 md:w-52 shrink-0 text-[12px] font-medium text-core-ink truncate">
        {s.sector}
      </div>
      <div className="flex-1 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-core-line overflow-hidden">
          <div
            className={`h-full rounded-full ${isPos ? "bg-core-teal" : "bg-core-negative"}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <span className={`text-[12px] font-bold tabular-nums w-16 text-right shrink-0 ${toneClass(pv)}`}>
          {fmtPct(pv)}
        </span>
        <span className={`text-[11px] tabular-nums w-14 text-right shrink-0 ${toneClass(rv)} hidden sm:block`}>
          {fmtPct(rv)} rev
        </span>
      </div>
      <span className="text-[10px] text-core-muted tabular-nums w-8 text-right shrink-0 hidden md:block">
        {s.companies_reported}
      </span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function YearInReview2026() {
  const [gainers, setGainers] = useState<MoverRow[]>([]);
  const [losers,  setLosers]  = useState<MoverRow[]>([]);
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [quarters, setQuarters] = useState<QuarterSummary[]>([]);
  const [loadingMovers,   setLoadingMovers]   = useState(true);
  const [loadingSectors,  setLoadingSectors]  = useState(true);
  const [loadingQuarters, setLoadingQuarters] = useState(true);

  useEffect(() => {
    // Use the most recent 2026 quarter that has data, not the env-var default
    // (which may point at a different quarter on this installation).
    const SECTOR_Q = [...CALENDAR_2026_QUARTERS]
      .reverse()
      .find((q) => q !== "Q3 FY27") ?? "Q2 FY27";

    // Each section loads independently — fast sections show immediately.

    // 1. Sectors (~800ms)
    fetch(`/api/sectors?quarter=${encodeURIComponent(SECTOR_Q)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          const raw = (j.data?.sectors ?? []) as SectorRow[];
          setSectors(
            [...raw]
              .filter((s) => s.profit_yoy != null)
              .sort((a, b) => (b.profit_yoy ?? 0) - (a.profit_yoy ?? 0))
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoadingSectors(false));

    // 2. Quarter summaries (~3s total — fetched in parallel)
    fetch("/api/quarters")
      .then((r) => r.json())
      .then(async (availableQRes) => {
        const all: string[] = availableQRes.ok ? (availableQRes.data ?? []) : [];
        const relevant = all.filter((q: string) => CALENDAR_2026_QUARTERS.includes(q));
        if (relevant.length === 0) return;
        const summaries = await Promise.all(
          relevant.map((q: string) =>
            fetch(`/api/summary?quarter=${encodeURIComponent(q)}`)
              .then((r) => r.json())
              .then((j) =>
                j.ok
                  ? ({
                      quarter:            q,
                      companies_reported: j.data.companies_reported ?? 0,
                      companies_tracked:  j.data.companies_tracked  ?? 0,
                      avg_revenue_yoy:    j.data.avg_revenue_yoy    ?? null,
                      avg_profit_yoy:     j.data.avg_profit_yoy     ?? null,
                    } as QuarterSummary)
                  : null
              )
              .catch(() => null)
          )
        );
        setQuarters(
          (summaries.filter(Boolean) as QuarterSummary[]).sort((a, b) =>
            CALENDAR_2026_QUARTERS.indexOf(a.quarter) - CALENDAR_2026_QUARTERS.indexOf(b.quarter)
          )
        );
      })
      .catch(() => {})
      .finally(() => setLoadingQuarters(false));

    // 3. Market movers YTD (~6s — loads last, page already visible by then)
    fetch("/api/market-movers?period=ytd&limit=5")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setGainers(j.data?.gainers ?? []);
          setLosers(j.data?.losers  ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingMovers(false));
  }, []);

  const totalReported = quarters.reduce((s, q) => s + q.companies_reported, 0);
  const latestQ       = quarters[quarters.length - 1];
  const avgRevYoy     = latestQ?.avg_revenue_yoy ?? null;
  const avgProfYoy    = latestQ?.avg_profit_yoy  ?? null;
  const maxAbsSector  = Math.max(
    0,
    ...sectors.map((s) => (s.profit_yoy != null && Math.abs(s.profit_yoy) <= 9.99 ? Math.abs(s.profit_yoy) : 0))
  );
  const loadingStats = loadingQuarters;

  return (
    <div className="pb-20">
      {/* ── Hero ── */}
      <div className="bg-core-ink text-white">
        <div className="container-core py-12 md:py-16">
          <div className="text-[10px] uppercase tracking-[0.28em] text-white/40 font-semibold mb-3">
            The Core · India Earnings
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tightest leading-[1.05] text-white mb-4">
            Year in Review
            <br />
            <span className="text-core-pink">2026</span>
          </h1>
          <p className="text-[15px] md:text-[16px] text-white/60 max-w-xl leading-relaxed">
            How India Inc. performed across revenue, profit, and markets.
            Updated as quarterly results come in.
          </p>
          <div className="flex items-center gap-2 mt-5">
            <span className="w-1.5 h-1.5 rounded-full bg-core-teal animate-pulse" />
            <span className="text-[11px] text-white/40 uppercase tracking-[0.16em]">
              Live — results still filing
            </span>
          </div>
        </div>
      </div>

      <div className="container-core py-10 md:py-12 space-y-14">

        {/* ── Stat strip ── */}
        {loadingStats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl border border-core-line p-5 animate-pulse">
                <div className="h-2.5 w-24 bg-core-line rounded mb-4" />
                <div className="h-8 w-20 bg-core-line rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile
              label="Companies tracked"
              value={(latestQ?.companies_tracked ?? 0).toLocaleString()}
              sub="NSE + BSE listed"
            />
            <StatTile
              label="Results filed in 2026"
              value={totalReported.toLocaleString()}
              sub="across all 2026 quarters"
            />
            <StatTile
              label={`${latestQ?.quarter ?? "Latest"} avg revenue`}
              value={fmtPct(avgRevYoy)}
              sub="year-over-year"
              tone={avgRevYoy != null ? (avgRevYoy > 0 ? "positive" : "negative") : "neutral"}
            />
            <StatTile
              label={`${latestQ?.quarter ?? "Latest"} avg profit`}
              value={fmtPct(avgProfYoy)}
              sub="year-over-year"
              tone={avgProfYoy != null ? (avgProfYoy > 0 ? "positive" : "negative") : "neutral"}
            />
          </div>
        )}

        {/* ── Quarterly timeline ── */}
        <section>
          <div className="flex items-baseline gap-3 mb-5 pb-3 border-b border-core-line">
            <h2 className="text-[20px] font-extrabold tracking-tightest">Earnings Seasons</h2>
            <span className="text-[12px] text-core-muted">Q4 FY26 through Q2 FY27</span>
          </div>
          {loadingQuarters ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="rounded-xl border border-core-line p-5 animate-pulse space-y-3">
                  <div className="h-3 w-20 bg-core-line rounded" />
                  <div className="h-7 w-28 bg-core-line rounded" />
                  <div className="h-1.5 w-full bg-core-line rounded-full" />
                </div>
              ))}
            </div>
          ) : quarters.length === 0 ? (
            <p className="text-[13px] text-core-muted italic">No quarterly data yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {quarters.map((qs, i) => (
                <QuarterCard
                  key={qs.quarter}
                  qs={qs}
                  isCurrent={i === quarters.length - 1}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Market Movers of the Year ── */}
        <section>
          <div className="flex items-baseline gap-3 mb-5 pb-3 border-b border-core-line">
            <h2 className="text-[20px] font-extrabold tracking-tightest">Market Movers of 2026</h2>
            <span className="text-[12px] text-core-muted">YTD adjusted returns</span>
          </div>
          {loadingMovers ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[0, 1].map((i) => (
                <div key={i} className="rounded-xl border border-core-line p-5 animate-pulse space-y-3">
                  {[...Array(5)].map((_, j) => (
                    <div key={j} className="flex gap-3">
                      <div className="h-3 w-4 bg-core-line rounded shrink-0" />
                      <div className="flex-1 h-3 bg-core-line rounded" />
                      <div className="h-4 w-12 bg-core-line rounded shrink-0" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-sm bg-core-teal shrink-0" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em]">Top Gainers</span>
                </div>
                <div className="border border-core-line rounded-xl overflow-hidden px-3">
                  {gainers.slice(0, 5).map((r, i) => (
                    <MoverLine key={r.ticker} row={r} rank={i + 1} side="gain" />
                  ))}
                </div>
                <Link
                  href="/market-movers"
                  className="block mt-2 text-center text-[11px] text-core-muted hover:text-core-pink transition-colors py-1"
                >
                  View all movers →
                </Link>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-sm bg-core-negative shrink-0" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em]">Top Losers</span>
                </div>
                <div className="border border-core-line rounded-xl overflow-hidden px-3">
                  {losers.slice(0, 5).map((r, i) => (
                    <MoverLine key={r.ticker} row={r} rank={i + 1} side="loss" />
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Sector Scorecard ── */}
        <section>
          <div className="flex items-baseline gap-3 mb-5 pb-3 border-b border-core-line">
            <h2 className="text-[20px] font-extrabold tracking-tightest">Sector Scorecard</h2>
            <span className="text-[12px] text-core-muted">
              {latestQ?.quarter ?? "Latest quarter"} · sorted by profit growth
            </span>
          </div>
          {loadingSectors ? (
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2 animate-pulse">
                  <div className="h-3 w-40 bg-core-line rounded shrink-0" />
                  <div className="flex-1 h-1.5 bg-core-line rounded-full" />
                  <div className="h-3 w-12 bg-core-line rounded shrink-0" />
                </div>
              ))}
            </div>
          ) : sectors.length === 0 ? (
            <p className="text-[13px] text-core-muted italic">No sector data yet.</p>
          ) : (
            <>
              <div className="flex gap-3 text-[9px] uppercase tracking-[0.14em] text-core-muted font-semibold mb-2 px-0">
                <span className="w-40 md:w-52 shrink-0">Sector</span>
                <span className="flex-1">Profit YoY</span>
                <span className="w-8 text-right shrink-0 hidden md:block">Co.</span>
              </div>
              <div className="border border-core-line rounded-xl px-4 overflow-hidden">
                {sectors.map((s) => (
                  <SectorScoreRow key={s.sector} s={s} maxAbs={maxAbsSector} />
                ))}
              </div>
              <Link
                href="/sectors"
                className="block mt-2 text-center text-[11px] text-core-muted hover:text-core-pink transition-colors py-1"
              >
                Full sector breakdown →
              </Link>
            </>
          )}
        </section>

      </div>
    </div>
  );
}
