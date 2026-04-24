import Link from "next/link";
import { formatINR, formatPct, pctToneClass, formatDate } from "@/lib/format";
import Sparkline from "./Sparkline";
import type { LatestQuarterRow } from "@/lib/types";

// "Featured" card — used for the top N reporters on the homepage. Designed
// to be scanned at a glance: company + sector up top, two big hero numbers
// (revenue + profit) with YoY delta chips beside, sparkline on the right,
// CTA at the bottom. Much more editorial than a row in a table.
export default function FeaturedCard({ row, quarter }: { row: LatestQuarterRow; quarter: string }) {
  const deltaClass = (v: number | null | undefined) => {
    if (v == null) return "delta-flat";
    if (v > 0) return "delta-up";
    if (v < 0) return "delta-down";
    return "delta-flat";
  };
  const sign = (v: number | null | undefined) =>
    v == null ? "" : v > 0 ? "▲" : v < 0 ? "▼" : "■";

  return (
    <Link
      href={`/company/${encodeURIComponent(row.ticker)}`}
      className="card card-hover block p-5 group"
    >
      {/* Header row — sector chip, ticker, external marker */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {row.sector ? (
              <span className="chip chip-ink">{row.sector}</span>
            ) : null}
            <span className="text-[11px] text-core-muted tabular-nums">{row.ticker}</span>
          </div>
          <div className="text-[17px] font-semibold tracking-tightest leading-tight truncate group-hover:text-core-pink transition-colors">
            {row.company_name}
          </div>
          <div className="text-[11px] text-core-muted mt-1">
            {quarter}
            {row.result_date ? (
              <> · Announced {formatDate(row.result_date)}</>
            ) : null}
          </div>
        </div>
      </div>

      {/* Two hero stats */}
      <div className="mt-4 grid grid-cols-2 gap-5">
        <HeroStat
          label="Revenue"
          value={formatINR(row.revenue)}
          delta={row.revenue_yoy}
          deltaClass={deltaClass(row.revenue_yoy)}
          sign={sign(row.revenue_yoy)}
        />
        <HeroStat
          label="Net profit"
          value={formatINR(row.net_profit)}
          delta={row.profit_yoy}
          deltaClass={deltaClass(row.profit_yoy)}
          sign={sign(row.profit_yoy)}
        />
      </div>

      {/* Footer — sparkline + subtle CTA */}
      <div className="mt-5 flex items-end justify-between border-t border-core-line pt-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-core-muted mb-1">
            Last 8 quarters revenue
          </div>
          <Sparkline data={row.revenue_trend ?? []} width={180} height={36} />
        </div>
        <div className="text-[12px] font-medium text-core-ink group-hover:text-core-pink transition-colors flex items-center gap-1">
          Full results
          <span aria-hidden>→</span>
        </div>
      </div>
    </Link>
  );
}

function HeroStat({
  label, value, delta, deltaClass, sign
}: {
  label: string; value: string;
  delta: number | null | undefined;
  deltaClass: string;
  sign: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-core-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums tracking-tightest">
        {value}
      </div>
      <div className={`delta ${deltaClass} mt-1`}>
        {delta != null ? (
          <>
            <span aria-hidden className="text-[10px]">{sign}</span>
            <span>{formatPct(delta)}</span>
            <span className="text-[10px] font-normal text-core-muted ml-1 uppercase tracking-wide">
              YoY
            </span>
          </>
        ) : (
          <span className="text-core-muted text-xs">— YoY</span>
        )}
      </div>
    </div>
  );
}
