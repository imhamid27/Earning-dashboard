import Link from "next/link";
import { formatINR, formatPct } from "@/lib/format";
import type { LatestQuarterRow } from "@/lib/types";

// Compact editorial strip for the hero — three "just reported" companies
// shown as minimal cards (company / revenue / YoY delta). Inspired by the
// FT.com top-stories rail.
export default function HeroReporterStrip({
  rows,
  emptyMessage
}: {
  rows: LatestQuarterRow[];
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-[13px] text-core-muted border-l border-core-line pl-5">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="flex md:grid md:grid-cols-3 divide-x divide-core-line border-l border-core-line">
      {rows.slice(0, 3).map((r) => {
        const yoy = r.revenue_yoy ?? null;
        const tone =
          yoy == null ? "text-core-muted"
          : yoy > 0   ? "text-core-teal"
          : yoy < 0   ? "text-core-negative"
          : "text-core-muted";
        return (
          <Link
            key={r.ticker}
            href={`/company/${encodeURIComponent(r.ticker)}`}
            className="block px-4 md:px-5 py-3 hover:bg-core-surface transition-colors shrink-0 w-[68vw] sm:w-[50vw] md:w-auto"
          >
            <div className="text-[10px] uppercase tracking-[0.14em] text-core-muted truncate">
              {r.sector ?? "—"}
            </div>
            <div className="text-[13px] font-semibold tracking-tightest truncate mt-1">
              {r.company_name}
            </div>
            <div className="flex items-baseline gap-2 mt-2 whitespace-nowrap">
              <span className="text-base font-bold tabular-nums">
                {formatINR(r.revenue)}
              </span>
              <span className={`text-xs font-semibold tabular-nums ${tone}`}>
                {yoy != null ? `${yoy > 0 ? "▲" : "▼"} ${formatPct(yoy)}` : "—"}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
