"use client";

// CompanyTable — Part 3 of the Corporate Earnings Dashboard upgrade.
//
// Enhancements vs previous version:
//  - Quality tags (Strong / Weak / Mixed) now sit on their own visual line,
//    styled as chips (not inline text) — easier to scan at a glance.
//  - Source confidence badge: "Verified from filing" when source = nse | bse.
//  - Revenue header label adapts for banks/NBFCs: "Total Income" or "Premium".
//  - Null cells show "—" with title="Data not available" for accessibility.
//  - Data flags array (data_flags) shown as a subtle warning chip.
//  - "Announced date · Quarter" already in Date column — confirmed.
//  - Best/worst row highlight confirmed working via highlightUp / highlightDown.

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatINR, formatYoY, pctToneClass, revenueFieldLabel } from "@/lib/format";
import { resultQuality } from "@/lib/insight";
import Sparkline from "./Sparkline";
import StatusBadge from "./StatusBadge";
import PdfLink from "./PdfLink";
import PriceChip from "./PriceChip";
import type { LatestQuarterRow } from "@/lib/types";

type SortKey = "company_name" | "sector" | "revenue" | "revenue_yoy" | "net_profit" | "profit_yoy";
type SortDir = "asc" | "desc";

export type PriceMap = Record<
  string,
  { last_price: number | null; change_pct: number | null }
>;

// Quality chip config — chip-style instead of inline text for Part 3.
const QUALITY_CFG = {
  strong: {
    cls:   "bg-core-teal/10 text-core-teal border border-core-teal/30",
    label: "Strong",
    icon:  "▲",
  },
  weak: {
    cls:   "bg-core-negative/10 text-core-negative border border-core-negative/20",
    label: "Weak",
    icon:  "▼",
  },
  mixed: {
    cls:   "bg-core-surface text-core-muted border border-core-line",
    label: "Mixed",
    icon:  "◆",
  },
} as const;

// Whether the filing source is exchange-direct (NSE/BSE filing).
function isVerifiedSource(src: string | null | undefined): boolean {
  return src === "nse" || src === "bse";
}

export default function CompanyTable({
  rows,
  preserveOrder = false,
  highlightUp,
  highlightDown,
  prices,
}: {
  rows: LatestQuarterRow[];
  /** If true, render rows in the order the parent passed them in. */
  preserveOrder?: boolean;
  /** Ticker to highlight with a light teal tint (outlier upside). */
  highlightUp?: string;
  /** Ticker to highlight with a light pink tint (outlier downside). */
  highlightDown?: string;
  /** ticker → {last_price, change_pct} map. */
  prices?: PriceMap;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Max revenue across this batch — scales the inline bar in each row.
  const maxRevenue = useMemo(() => {
    let m = 0;
    for (const r of rows) if (r.revenue != null && r.revenue > m) m = r.revenue;
    return m || 1;
  }, [rows]);

  // Detect whether any row is a bank/NBFC so we can rename the column header.
  const revenueLabel = useMemo(() => {
    for (const r of rows) {
      const lbl = revenueFieldLabel(r.industry);
      if (lbl !== "Revenue") return lbl; // first non-standard wins
    }
    return "Revenue";
  }, [rows]);

  const sorted = useMemo(() => {
    if (preserveOrder) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string")
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [rows, sortKey, sortDir, preserveOrder]);

  const onSort = (k: SortKey) => {
    if (preserveOrder) return;
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "company_name" || k === "sector" ? "asc" : "desc");
    }
  };

  if (rows.length === 0) {
    return (
      <div className="card p-10 text-center text-sm text-core-muted">
        No companies match these filters.
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <Th k="company_name" label="Company" {...{ sortKey, sortDir, onSort }} />
            <Th k="sector" label="Sector" {...{ sortKey, sortDir, onSort }} />
            <th>Date · Quarter</th>
            <Th k="revenue"     label={revenueLabel}  align="right" {...{ sortKey, sortDir, onSort }} />
            <Th k="revenue_yoy" label="Rev YoY"       align="right" {...{ sortKey, sortDir, onSort }} />
            <Th k="net_profit"  label="Net profit"    align="right" {...{ sortKey, sortDir, onSort }} />
            <Th k="profit_yoy"  label="Profit YoY"   align="right" {...{ sortKey, sortDir, onSort }} />
            <th className="text-right whitespace-nowrap">Trend</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const notReported = !r.quarter_end_date;
            const hasNumbers =
              r.status === "announced_with_numbers" ||
              (r.status === "announced" &&
                (r.revenue != null || r.net_profit != null));
            const isUpOutlier   = highlightUp   && r.ticker === highlightUp;
            const isDownOutlier = highlightDown && r.ticker === highlightDown;
            const rowCls = notReported
              ? "text-core-muted/70"
              : isUpOutlier
              ? "bg-core-teal/5"
              : isDownOutlier
              ? "bg-core-negative/5"
              : undefined;

            // Quality tag — chip style (Part 3 spec)
            const quality = hasNumbers ? resultQuality(r) : null;

            // Source confidence
            const verified = isVerifiedSource(r.source);

            // Data flags (e.g. "revenue_low", "yoy_extreme")
            const flags = r.data_flags ?? [];

            return (
              <tr key={r.ticker} data-ticker={r.ticker} className={rowCls}>
                {/* ---- Company cell ---- */}
                <td>
                  <Link
                    href={`/company/${encodeURIComponent(r.ticker)}`}
                    className="font-semibold text-core-ink hover:text-core-pink tracking-tight"
                  >
                    {r.company_name}
                  </Link>
                  {/* Sub-line: ticker · PDF link · price · verified badge */}
                  <div className="text-[11px] text-core-muted tabular-nums flex items-center gap-2 flex-wrap mt-0.5">
                    <span>{r.ticker}</span>
                    {r.filing_url ? (
                      <PdfLink
                        url={r.filing_url}
                        compact
                        ticker={r.ticker}
                        companyName={r.company_name}
                        source="homepage_table"
                      />
                    ) : null}
                    <PriceChip p={prices ? prices[r.ticker] : null} />
                    {verified ? (
                      <span
                        className="text-[9px] uppercase tracking-[0.12em] text-core-teal font-semibold"
                        title="Data sourced directly from exchange filing (NSE/BSE)"
                      >
                        ✓ Verified filing
                      </span>
                    ) : null}
                  </div>
                  {/* Quality chip — sits on its own line so it never competes with the ticker */}
                  {quality ? (
                    <div className="mt-1.5">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.1em] font-bold ${QUALITY_CFG[quality].cls}`}
                      >
                        <span className="text-[8px]">{QUALITY_CFG[quality].icon}</span>
                        {QUALITY_CFG[quality].label}
                      </span>
                    </div>
                  ) : null}
                  {/* Data flags — validation warnings */}
                  {flags.length > 0 ? (
                    <div className="mt-1">
                      {flags.map((f) => (
                        <span
                          key={f}
                          className="inline-flex items-center mr-1 px-1.5 py-0.5 rounded text-[9px] bg-amber-50 text-amber-700 border border-amber-200 font-semibold"
                          title={flagTitle(f)}
                        >
                          ⚠ {flagShort(f)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </td>

                {/* ---- Sector ---- */}
                <td className="text-sm text-core-muted">
                  {r.sector ?? <span title="Data not available" className="text-core-muted/50">—</span>}
                </td>

                {/* ---- Date · Quarter ---- */}
                <td>
                  <StatusBadge row={r} />
                </td>

                {/* ---- Financial columns ---- */}
                {notReported || !hasNumbers ? (
                  <td colSpan={5} className="text-sm text-core-muted italic">
                    {r.status === "scheduled" && r.next_result_date
                      ? `Results expected on ${formatDateShort(r.next_result_date)}${daysUntilLabel(r.next_result_date)}`
                      : r.status === "announced"
                      ? "Results announced — numbers to follow"
                      : "Data not available"}
                  </td>
                ) : (
                  <>
                    {/* Revenue + inline scale bar */}
                    <td className="text-right tabular-nums">
                      <div className="font-semibold">
                        {r.revenue != null ? (
                          formatINR(r.revenue)
                        ) : (
                          <span
                            className="text-core-muted/60 text-[12px]"
                            title="Data not available"
                          >
                            —
                          </span>
                        )}
                      </div>
                      <div className="mt-1 ml-auto w-[110px]">
                        <div className="h-[3px] bg-core-line rounded-full overflow-hidden">
                          <div
                            className="h-full bg-core-ink"
                            style={{
                              width: `${
                                Math.max(0, Math.min(1, (r.revenue ?? 0) / maxRevenue)) * 100
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>

                    <td
                      className={`text-right tabular-nums font-semibold whitespace-nowrap ${pctToneClass(r.revenue_yoy)}`}
                    >
                      {r.revenue_yoy != null ? (
                        formatYoY(r.revenue_yoy)
                      ) : (
                        <span title="Data not available" className="text-core-muted/60 font-normal">
                          —
                        </span>
                      )}
                    </td>

                    <td className="text-right tabular-nums font-semibold">
                      {r.net_profit != null ? (
                        formatINR(r.net_profit)
                      ) : (
                        <span
                          className="text-core-muted/60 text-[12px] font-normal"
                          title="Data not available"
                        >
                          —
                        </span>
                      )}
                    </td>

                    <td
                      className={`text-right tabular-nums font-semibold whitespace-nowrap ${pctToneClass(r.profit_yoy)}`}
                    >
                      {r.profit_yoy != null ? (
                        formatYoY(r.profit_yoy)
                      ) : (
                        <span title="Data not available" className="text-core-muted/60 font-normal">
                          —
                        </span>
                      )}
                    </td>

                    <td className="text-right">
                      <div className="flex justify-end">
                        <Sparkline data={r.revenue_trend ?? []} />
                      </div>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function daysUntilLabel(iso: string): string {
  const target = new Date(iso + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - now.getTime()) / 86_400_000);
  if (diff < 0)   return "";
  if (diff === 0) return " · today";
  if (diff === 1) return " · tomorrow";
  if (diff <= 14) return ` · in ${diff}d`;
  return "";
}

function formatDateShort(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function flagShort(flag: string): string {
  if (flag === "revenue_low")    return "Rev. low";
  if (flag === "yoy_extreme")    return "YoY extreme";
  if (flag === "profit_unusual") return "Unusual profit";
  return flag.replace(/_/g, " ");
}

function flagTitle(flag: string): string {
  if (flag === "revenue_low")    return "Revenue appears low for a large-cap — verify against official filing";
  if (flag === "yoy_extreme")    return "YoY > 1000% — may be due to a near-zero base; verify";
  if (flag === "profit_unusual") return "Profit figure appears outside expected range — verify against filing";
  return "Data validation flag — verify against official filing";
}

function Th({
  k,
  label,
  align,
  sortKey,
  sortDir,
  onSort,
}: {
  k: SortKey;
  label: string;
  align?: "left" | "right";
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th
      className={`${align === "right" ? "text-right" : ""} whitespace-nowrap cursor-pointer select-none hover:text-core-ink`}
      onClick={() => onSort(k)}
    >
      <span className={`inline-flex items-center gap-1 ${active ? "text-core-ink" : ""}`}>
        {label}
        <span className="text-[9px] opacity-60">
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </span>
    </th>
  );
}
