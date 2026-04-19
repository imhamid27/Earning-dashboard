import Link from "next/link";
import { formatINR, formatPct, pctToneClass, formatDate } from "@/lib/format";
import Sparkline from "./Sparkline";
import DataQualityBadge from "./DataQualityBadge";
import type { LatestQuarterRow } from "@/lib/types";

// Full-width feature card used on the main dashboard for companies that have
// just reported. Think Bloomberg "as it happens" panel — big numbers, clear
// hierarchy, trend sparkline, link into the full detail page.
export default function CompanyCard({ row, quarter }: { row: LatestQuarterRow; quarter: string }) {
  return (
    <div className="card p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-core-muted">
            {row.sector ?? "—"}
          </div>
          <Link
            href={`/company/${encodeURIComponent(row.ticker)}`}
            className="serif text-2xl leading-tight tracking-tight hover:text-core-accent truncate block"
          >
            {row.company_name}
          </Link>
          <div className="text-[11px] text-core-muted mt-1">
            {row.ticker} · reported {quarter}
            {row.quarter_end_date ? ` · period end ${formatDate(row.quarter_end_date)}` : ""}
          </div>
        </div>
        <DataQualityBadge status={row.data_quality_status} />
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-4 pt-1">
        <Stat
          label="Revenue"
          value={formatINR(row.revenue)}
          delta={row.revenue_yoy}
          deltaSuffix="YoY"
        />
        <Stat
          label="Net profit"
          value={formatINR(row.net_profit)}
          delta={row.profit_yoy}
          deltaSuffix="YoY"
        />
        <Stat
          label="Operating profit"
          value={formatINR(row.operating_profit)}
          mono
        />
        <Stat
          label="EPS"
          value={row.eps != null ? `₹${row.eps.toFixed(2)}` : "—"}
          mono
        />
      </div>

      {/* Footer: sparkline + CTA */}
      <div className="flex items-end justify-between pt-2 border-t border-core-line">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-core-muted mb-1">
            Last 8 quarters · revenue
          </div>
          <Sparkline data={row.revenue_trend ?? []} width={180} height={36} />
        </div>
        <Link
          href={`/company/${encodeURIComponent(row.ticker)}`}
          className="text-sm link-red"
        >
          Full results →
        </Link>
      </div>
    </div>
  );
}

function Stat({
  label, value, delta, deltaSuffix, mono
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaSuffix?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-core-muted">{label}</div>
      <div className={`mt-1 serif text-2xl tabular-nums tracking-tight`}>{value}</div>
      {delta != null ? (
        <div className={`text-xs mt-0.5 font-medium ${pctToneClass(delta)}`}>
          {formatPct(delta)} {deltaSuffix}
        </div>
      ) : mono ? (
        <div className="text-xs mt-0.5 text-core-muted">&nbsp;</div>
      ) : null}
    </div>
  );
}
