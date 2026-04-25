"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatINR, formatYoY, pctToneClass, formatDate } from "@/lib/format";
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

const QUALITY_CFG = {
  strong: { cls: "text-core-teal",     label: "Strong quarter" },
  weak:   { cls: "text-core-negative", label: "Weak quarter"   },
  mixed:  { cls: "text-core-muted",    label: "Mixed"          },
} as const;

export default function CompanyTable({
  rows,
  preserveOrder = false,
  highlightUp,
  highlightDown,
  prices,
}: {
  rows: LatestQuarterRow[];
  /**
   * If true, render rows in the order the parent passed them in. Used
   * when the parent controls sorting externally (e.g. the homepage
   * All-reporters dropdown). Column-header clicks are still visual
   * cues in that mode — they don't re-sort.
   */
  preserveOrder?: boolean;
  /** Ticker to highlight with a light teal tint (outlier upside). */
  highlightUp?: string;
  /** Ticker to highlight with a light pink tint (outlier downside). */
  highlightDown?: string;
  /** ticker → {last_price, change_pct} map. If absent, no price shown. */
  prices?: PriceMap;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Max revenue across this batch — used to scale the inline bar in each
  // row. Makes "how big is this company" instantly legible at a glance.
  const maxRevenue = useMemo(() => {
    let m = 0;
    for (const r of rows) if (r.revenue != null && r.revenue > m) m = r.revenue;
    return m || 1;
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
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [rows, sortKey, sortDir, preserveOrder]);

  const onSort = (k: SortKey) => {
    if (preserveOrder) return;
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "company_name" || k === "sector" ? "asc" : "desc"); }
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
            <th>Date</th>
            <Th k="revenue"     label="Revenue"    align="right" {...{ sortKey, sortDir, onSort }} />
            <Th k="revenue_yoy" label="Rev YoY"    align="right" {...{ sortKey, sortDir, onSort }} />
            <Th k="net_profit"  label="Net profit" align="right" {...{ sortKey, sortDir, onSort }} />
            <Th k="profit_yoy"  label="Profit YoY" align="right" {...{ sortKey, sortDir, onSort }} />
            <th className="text-right whitespace-nowrap">Trend</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const notReported = !r.quarter_end_date;
            // "Has numbers" = at least one of rev/np is present. A partial
            // row with just revenue still deserves a proper table row —
            // dashes fill in for missing cells via formatINR(null) → "—".
            const hasNumbers =
              r.status === "announced_with_numbers" ||
              (r.status === "announced" && (r.revenue != null || r.net_profit != null));
            const isUpOutlier   = highlightUp   && r.ticker === highlightUp;
            const isDownOutlier = highlightDown && r.ticker === highlightDown;
            const rowCls = notReported
              ? "text-core-muted/70"
              : isUpOutlier
                ? "bg-core-teal/5"
                : isDownOutlier
                  ? "bg-core-negative/5"
                  : undefined;

            // Result quality tag — only shown when we have YoY context.
            const quality = hasNumbers ? resultQuality(r) : null;

            return (
              <tr
                key={r.ticker}
                data-ticker={r.ticker}
                className={rowCls}
              >
                <td>
                  <Link href={`/company/${encodeURIComponent(r.ticker)}`} className="font-semibold text-core-ink hover:text-core-pink tracking-tight">
                    {r.company_name}
                  </Link>
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
                    {/* Result quality chip — only when context is available */}
                    {quality ? (
                      <span className={`text-[10px] uppercase tracking-[0.1em] font-semibold ${QUALITY_CFG[quality].cls}`}>
                        {QUALITY_CFG[quality].label}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="text-sm text-core-muted">{r.sector ?? "—"}</td>
                <td><StatusBadge row={r} /></td>
                {notReported || !hasNumbers ? (
                  <td colSpan={5} className="text-sm text-core-muted italic">
                    {r.status === "scheduled" && r.next_result_date
                      ? `Results expected on ${formatDate(r.next_result_date)}${daysUntilLabel(r.next_result_date)}`
                      : r.status === "announced"
                      ? "Results announced — numbers to follow"
                      : "Awaiting announcement"}
                  </td>
                ) : (
                  <>
                    {/* Revenue + inline scale bar */}
                    <td className="text-right tabular-nums">
                      <div className="font-semibold">
                        {r.revenue != null ? formatINR(r.revenue) : <span className="text-core-muted italic text-[12px]">N/A</span>}
                      </div>
                      <div className="mt-1 ml-auto w-[110px]">
                        <div className="h-[3px] bg-core-line rounded-full overflow-hidden">
                          <div
                            className="h-full bg-core-ink"
                            style={{ width: `${Math.max(0, Math.min(1, (r.revenue ?? 0) / maxRevenue)) * 100}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className={`text-right tabular-nums font-semibold whitespace-nowrap ${pctToneClass(r.revenue_yoy)}`}>
                      {formatYoY(r.revenue_yoy)}
                    </td>
                    <td className="text-right tabular-nums font-semibold">
                      {r.net_profit != null ? formatINR(r.net_profit) : <span className="text-core-muted italic text-[12px]">N/A</span>}
                    </td>
                    <td className={`text-right tabular-nums font-semibold whitespace-nowrap ${pctToneClass(r.profit_yoy)}`}>
                      {formatYoY(r.profit_yoy)}
                    </td>
                    <td className="text-right"><div className="flex justify-end"><Sparkline data={r.revenue_trend ?? []} /></div></td>
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

function daysUntilLabel(iso: string): string {
  const target = new Date(iso + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - now.getTime()) / 86_400_000);
  if (diff < 0)  return "";
  if (diff === 0) return " · today";
  if (diff === 1) return " · tomorrow";
  if (diff <= 14) return ` · in ${diff}d`;
  return "";
}

function Th({
  k, label, align, sortKey, sortDir, onSort
}: {
  k: SortKey; label: string; align?: "left" | "right";
  sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th
      className={`${align === "right" ? "text-right" : ""} whitespace-nowrap cursor-pointer select-none hover:text-core-ink`}
      onClick={() => onSort(k)}
    >
      <span className={`inline-flex items-center gap-1 ${active ? "text-core-ink" : ""}`}>
        {label}
        <span className="text-[9px] opacity-60">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
      </span>
    </th>
  );
}
