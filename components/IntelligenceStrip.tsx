"use client";

import Link from "next/link";
import { formatPct } from "@/lib/format";
import type { LatestQuarterRow } from "@/lib/types";

export type IntelligenceStripProps = {
  quarter: string | null;
  companies_tracked: number;
  companies_reported: number;
  avg_revenue_yoy: number | null;
  avg_profit_yoy: number | null;
  biggestGainer: LatestQuarterRow | null;
  biggestLoser: LatestQuarterRow | null;
  heaviestFiler: LatestQuarterRow | null;
};

export default function IntelligenceStrip(props: IntelligenceStripProps) {
  const {
    quarter,
    companies_tracked,
    companies_reported,
    avg_revenue_yoy,
    avg_profit_yoy,
    biggestGainer,
    biggestLoser,
    heaviestFiler,
  } = props;

  const pct =
    companies_tracked > 0
      ? Math.min(100, Math.round((companies_reported / companies_tracked) * 100))
      : 0;

  return (
    <div
      className="
        grid grid-cols-2 md:grid-cols-4
        divide-x divide-y md:divide-y-0
        divide-core-line border-y border-core-line mb-6
      "
    >
      <Tile
        label={`${quarter ?? "Q4"} PROGRESS`}
        value={
          <>
            <span className="tabular-nums">{companies_reported.toLocaleString("en-IN")}</span>
            <span className="text-core-line-2 font-normal text-[18px] mx-1">/</span>
            <span className="tabular-nums text-core-muted font-bold text-[18px]">
              {companies_tracked.toLocaleString("en-IN")}
            </span>
          </>
        }
        sub={
          <>
            <div className="h-[3px] bg-core-line rounded-full overflow-hidden mt-1.5 mb-1">
              <div
                className="h-full bg-core-pink"
                style={{ width: `${pct}%` }}
                aria-label={`${pct}% of universe reported`}
              />
            </div>
            <span className="text-core-muted">{pct}% of tracked universe reported</span>
          </>
        }
      />

      <Tile
        label="SEASON . AVG REVENUE"
        value={
          avg_revenue_yoy != null ? (
            <span
              className={`tabular-nums ${avg_revenue_yoy >= 0 ? "text-core-teal" : "text-core-negative"}`}
            >
              {formatPct(avg_revenue_yoy)}
            </span>
          ) : (
            <span className="text-core-muted">Data not available</span>
          )
        }
        sub={
          <>
            <span className="text-core-muted">YoY across filed companies . </span>
            {avg_profit_yoy != null ? (
              <span
                className={avg_profit_yoy >= 0 ? "text-core-teal" : "text-core-negative"}
              >
                profit {formatPct(avg_profit_yoy)}
              </span>
            ) : (
              <span>profit Data not available</span>
            )}
          </>
        }
      />

      <Tile
        label="TOP GAINER . PROFIT YoY"
        value={
          biggestGainer && (biggestGainer.profit_yoy != null || biggestGainer.profit_yoy_label) ? (
            <span className="tabular-nums text-core-teal">
              {formatPct(biggestGainer.profit_yoy, 0, { label: biggestGainer.profit_yoy_label ?? null })}
            </span>
          ) : (
            <span className="text-core-muted">Data not available</span>
          )
        }
        sub={
          biggestGainer ? (
            <Link
              href={`/company/${encodeURIComponent(biggestGainer.ticker)}`}
              className="truncate hover:text-core-ink font-medium text-core-ink/80"
              title={biggestGainer.company_name}
            >
              {biggestGainer.company_name}
            </Link>
          ) : (
            <span className="text-core-muted">Waiting for a breakout</span>
          )
        }
      />

      <Tile
        label="TOP DECLINER . PROFIT YoY"
        value={
          biggestLoser && (biggestLoser.profit_yoy != null || biggestLoser.profit_yoy_label) ? (
            <span className="tabular-nums text-core-negative">
              {formatPct(biggestLoser.profit_yoy, 0, { label: biggestLoser.profit_yoy_label ?? null })}
            </span>
          ) : (
            <span className="text-core-muted">Data not available</span>
          )
        }
        sub={
          biggestLoser ? (
            <Link
              href={`/company/${encodeURIComponent(biggestLoser.ticker)}`}
              className="truncate hover:text-core-ink font-medium text-core-ink/80"
              title={biggestLoser.company_name}
            >
              {biggestLoser.company_name}
            </Link>
          ) : heaviestFiler ? (
            <span className="text-core-muted truncate">
              Heaviest filer: {heaviestFiler.company_name}
            </span>
          ) : (
            <span className="text-core-muted">No declines yet</span>
          )
        }
      />
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="px-3.5 py-3 md:px-5 md:py-3.5 min-w-0">
      <div className="text-[9px] uppercase tracking-[0.18em] text-core-muted font-semibold truncate">
        {label}
      </div>
      <div className="mt-1 text-[20px] md:text-[26px] leading-tight font-bold tracking-tightest">
        {value}
      </div>
      {sub ? (
        <div className="mt-1.5 text-[11px] leading-snug min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {sub}
        </div>
      ) : null}
    </div>
  );
}
