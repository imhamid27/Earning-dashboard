"use client";

import Link from "next/link";
import type { LatestQuarterRow } from "@/lib/types";

// Unified 8-tile stat grid — 4×2 on desktop, 2×4 on mobile.
//
// Row 1 (season macro):  Progress · Avg Revenue · Avg Net Profit · Top Gainer
// Row 2 (sector+micro):  Top Decliner · Top Sector · Weakest Sector · Sector CTA
//
// All tiles share one border-y container with divide-x + divide-y so the
// grid looks like a single cohesive block with no gap or double-border.

export type IntelligenceStripProps = {
  quarter: string | null;
  companies_tracked: number;
  companies_reported: number;
  avg_revenue_yoy: number | null;
  avg_profit_yoy: number | null;
  top_sector_by_profit:    { sector: string; profit_yoy: number } | null;
  bottom_sector_by_profit: { sector: string; profit_yoy: number } | null;
  biggestGainer: LatestQuarterRow | null;
  biggestLoser:  LatestQuarterRow | null;
  heaviestFiler: LatestQuarterRow | null;
};

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  const rounded = (v * 100).toFixed(1);
  if (parseFloat(rounded) === 0) return "0.0%";
  return `${v > 0 ? "+" : ""}${rounded}%`;
}

function pctClass(v: number | null): string {
  if (v == null) return "text-core-muted";
  const rounded = parseFloat((v * 100).toFixed(1));
  if (rounded > 0) return "text-core-teal";
  if (rounded < 0) return "text-core-negative";
  return "text-core-muted";
}

export default function IntelligenceStrip({
  quarter,
  companies_tracked,
  companies_reported,
  avg_revenue_yoy,
  avg_profit_yoy,
  top_sector_by_profit,
  bottom_sector_by_profit,
  biggestGainer,
  biggestLoser,
  heaviestFiler,
}: IntelligenceStripProps) {
  const pct =
    companies_tracked > 0
      ? Math.min(100, Math.round((companies_reported / companies_tracked) * 100))
      : 0;

  return (
    <div
      className="
        grid grid-cols-2 md:grid-cols-4
        divide-x divide-y
        divide-core-line border-y border-core-line mb-6
      "
    >
      {/* ── Row 1 ── */}

      {/* T1 · Season progress */}
      <Tile label={`${quarter ?? "Q4"} PROGRESS`}>
        <div className="mt-1 text-[20px] md:text-[26px] leading-tight font-bold tracking-tightest">
          <span className="tabular-nums">{companies_reported.toLocaleString("en-IN")}</span>
          <span className="text-core-muted font-normal text-[18px] mx-1">/</span>
          <span className="tabular-nums text-core-muted font-bold text-[18px]">
            {companies_tracked.toLocaleString("en-IN")}
          </span>
        </div>
        <div className="mt-1.5 text-[11px] leading-snug min-w-0">
          <div className="h-[3px] bg-core-line rounded-full overflow-hidden mb-1">
            <div className="h-full bg-core-pink" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-core-muted">{pct}% of tracked universe reported</span>
        </div>
      </Tile>

      {/* T2 · Avg revenue YoY */}
      <Tile label="Avg revenue · YoY">
        <div className={`mt-1 text-[20px] md:text-[26px] leading-tight font-bold tabular-nums tracking-tightest ${pctClass(avg_revenue_yoy)}`}>
          {fmtPct(avg_revenue_yoy)}
        </div>
        <div className="mt-1.5 text-[11px] text-core-muted leading-snug">
          Season average across filed companies
        </div>
      </Tile>

      {/* T3 · Avg net profit YoY */}
      <Tile label="Avg net profit · YoY">
        <div className={`mt-1 text-[20px] md:text-[26px] leading-tight font-bold tabular-nums tracking-tightest ${pctClass(avg_profit_yoy)}`}>
          {fmtPct(avg_profit_yoy)}
        </div>
        <div className="mt-1.5 text-[11px] text-core-muted leading-snug">
          Season average across filed companies
        </div>
      </Tile>

      {/* T4 · Top gainer */}
      <Tile label="Top gainer · profit YoY">
        <div className={`mt-1 text-[20px] md:text-[26px] leading-tight font-bold tabular-nums tracking-tightest ${biggestGainer?.profit_yoy != null ? "text-core-teal" : "text-core-muted"}`}>
          {biggestGainer?.profit_yoy != null
            ? `+${(biggestGainer.profit_yoy * 100).toFixed(0)}%`
            : "—"}
        </div>
        <div className="mt-1.5 text-[11px] leading-snug min-w-0">
          {biggestGainer ? (
            <Link
              href={`/company/${encodeURIComponent(biggestGainer.ticker)}`}
              className="truncate block hover:text-core-ink font-medium text-core-ink/80"
              title={biggestGainer.company_name}
            >
              {biggestGainer.company_name}
            </Link>
          ) : (
            <span className="text-core-muted">Waiting for a breakout</span>
          )}
        </div>
      </Tile>

      {/* ── Row 2 ── */}

      {/* T5 · Top decliner */}
      <Tile label="Top decliner · profit YoY">
        <div className={`mt-1 text-[20px] md:text-[26px] leading-tight font-bold tabular-nums tracking-tightest ${biggestLoser?.profit_yoy != null ? "text-core-negative" : "text-core-muted"}`}>
          {biggestLoser?.profit_yoy != null
            ? `${(biggestLoser.profit_yoy * 100).toFixed(0)}%`
            : "—"}
        </div>
        <div className="mt-1.5 text-[11px] leading-snug min-w-0">
          {biggestLoser ? (
            <Link
              href={`/company/${encodeURIComponent(biggestLoser.ticker)}`}
              className="truncate block hover:text-core-ink font-medium text-core-ink/80"
              title={biggestLoser.company_name}
            >
              {biggestLoser.company_name}
            </Link>
          ) : heaviestFiler ? (
            <span className="text-core-muted truncate block">
              Heaviest filer: {heaviestFiler.company_name}
            </span>
          ) : (
            <span className="text-core-muted">No declines yet</span>
          )}
        </div>
      </Tile>

      {/* T6 · Top performing sector */}
      <Tile label="Top sector · profit YoY">
        {top_sector_by_profit ? (
          <>
            <div className="mt-1 text-[13px] md:text-[15px] leading-snug font-bold text-core-teal line-clamp-2">
              {top_sector_by_profit.sector}
            </div>
            <div className="mt-1.5 text-[11px] text-core-muted leading-snug">
              <span className="text-core-teal font-semibold tabular-nums">
                {fmtPct(top_sector_by_profit.profit_yoy)}
              </span>
              {" "}profit YoY · aggregate
            </div>
          </>
        ) : (
          <div className="mt-1 text-[20px] md:text-[26px] font-bold text-core-muted">—</div>
        )}
      </Tile>

      {/* T7 · Weakest sector */}
      <Tile label="Weakest sector · profit YoY">
        {bottom_sector_by_profit ? (
          <>
            <div className="mt-1 text-[13px] md:text-[15px] leading-snug font-bold text-core-negative line-clamp-2">
              {bottom_sector_by_profit.sector}
            </div>
            <div className="mt-1.5 text-[11px] text-core-muted leading-snug">
              <span className="text-core-negative font-semibold tabular-nums">
                {fmtPct(bottom_sector_by_profit.profit_yoy)}
              </span>
              {" "}profit YoY · aggregate
            </div>
          </>
        ) : (
          <div className="mt-1 text-[20px] md:text-[26px] font-bold text-core-muted">—</div>
        )}
      </Tile>

      {/* T8 · Sector Snapshot CTA */}
      <div className="px-3.5 py-3 md:px-5 md:py-3.5 flex flex-col justify-center gap-2">
        <div className="text-[9px] uppercase tracking-[0.18em] text-core-muted font-semibold">
          Sector deep-dive
        </div>
        <Link
          href="/sectors"
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-core-ink hover:text-core-pink transition-colors"
        >
          Sector Snapshot
          <span className="text-[10px]">→</span>
        </Link>
        <div className="text-[11px] text-core-muted leading-snug">
          All sectors ranked by profit &amp; revenue
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3.5 py-3 md:px-5 md:py-3.5 min-w-0">
      <div className="text-[9px] uppercase tracking-[0.18em] text-core-muted font-semibold truncate">
        {label}
      </div>
      {children}
    </div>
  );
}
