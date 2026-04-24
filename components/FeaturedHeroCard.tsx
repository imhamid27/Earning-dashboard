import Link from "next/link";
import { formatINR, formatPct, formatDate } from "@/lib/format";
import Sparkline from "./Sparkline";
import { deriveInsight } from "@/lib/insight";
import type { LatestQuarterRow } from "@/lib/types";

export default function FeaturedHeroCard({ row, quarter }: { row: LatestQuarterRow; quarter: string }) {
  const tone = (v: number | null | undefined) =>
    v == null ? "text-core-muted" :
    v > 0 ? "text-core-teal" :
    v < 0 ? "text-core-negative" : "text-core-muted";
  const sign = (v: number | null | undefined) => v == null ? "" : v > 0 ? "▲" : v < 0 ? "▼" : "■";

  return (
    <Link
      href={`/company/${encodeURIComponent(row.ticker)}`}
      className="card card-hover block group xl:col-span-2"
    >
      <div className="grid grid-cols-1 md:grid-cols-5 gap-0">
        <div className="md:col-span-3 p-6 md:p-7 space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="chip chip-pink">Lead reporter</span>
              {row.sector ? <span className="chip chip-ink">{row.sector}</span> : null}
              <span className="text-[11px] text-core-muted tabular-nums ml-auto">{row.ticker}</span>
            </div>
            <h3 className="text-[24px] md:text-[28px] font-bold tracking-tightest leading-[1.1] group-hover:text-core-pink transition-colors">
              {row.company_name}
            </h3>
            <div className="text-[11px] text-core-muted mt-1">
              {quarter}
              {row.result_date ? (
                <> · Results announced on <span className="text-core-ink font-medium">{formatDate(row.result_date)}</span></>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-core-muted">Revenue</div>
              <div className="mt-1.5 text-[32px] font-bold tabular-nums tracking-tightest leading-none">
                {formatINR(row.revenue, { invalid: !!row.revenue_validation_issue })}
              </div>
              <div className={`mt-2 text-sm font-semibold tabular-nums ${tone(row.revenue_yoy)}`}>
                {row.revenue_yoy != null ? (
                  <>
                    <span className="text-[10px]">{sign(row.revenue_yoy)}</span>{" "}
                    {formatPct(row.revenue_yoy)}
                    <span className="text-[10px] font-normal text-core-muted ml-1.5 uppercase tracking-wide">YoY</span>
                  </>
                ) : "Data not available"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-core-muted">Net profit</div>
              <div className="mt-1.5 text-[32px] font-bold tabular-nums tracking-tightest leading-none">
                {formatINR(row.net_profit, {
                  invalid: !!row.net_profit_validation_issue,
                  zeroLabel: "No profit reported"
                })}
              </div>
              <div className={`mt-2 text-sm font-semibold tabular-nums ${tone(row.profit_yoy)}`}>
                {row.profit_yoy != null || row.profit_yoy_label ? (
                  <>
                    {!row.profit_yoy_label ? <span className="text-[10px]">{sign(row.profit_yoy)}</span> : null}{" "}
                    {formatPct(row.profit_yoy, 1, { label: row.profit_yoy_label })}
                    <span className="text-[10px] font-normal text-core-muted ml-1.5 uppercase tracking-wide">YoY</span>
                  </>
                ) : "Data not available"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2 text-[11px]">
            {row.operating_profit != null ? (
              <span className="text-core-muted">
                Op. profit <span className="text-core-ink font-semibold tabular-nums">{formatINR(row.operating_profit)}</span>
              </span>
            ) : null}
            {row.eps != null ? (
              <span className="text-core-muted">
                EPS <span className="text-core-ink font-semibold tabular-nums">₹{row.eps.toFixed(2)}</span>
              </span>
            ) : null}
          </div>

          {(() => {
            const insight = deriveInsight(row);
            return insight ? (
              <div className="pt-3 border-t border-core-line">
                <div className="text-[11px] uppercase tracking-[0.14em] text-core-muted mb-1">
                  The takeaway
                </div>
                <p className="text-[13px] text-core-ink leading-snug">{insight}</p>
              </div>
            ) : null;
          })()}
        </div>

        <div className="md:col-span-2 bg-core-surface border-t md:border-t-0 md:border-l border-core-line p-6 flex flex-col justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-core-muted">
              Revenue · last 8 quarters
            </div>
            <div className="mt-3">
              <Sparkline data={row.revenue_trend ?? []} width={280} height={70} />
            </div>
          </div>
          <div className="mt-6 flex items-center gap-1 text-[13px] font-semibold text-core-ink group-hover:text-core-pink transition-colors">
            Full results
            <span aria-hidden>→</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
