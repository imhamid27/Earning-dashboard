import { formatPct, pctToneClass } from "@/lib/format";

interface SummaryData {
  quarter: string | null;
  companies_tracked: number;
  companies_reported: number;
  avg_revenue_yoy: number | null;
  avg_profit_yoy: number | null;
  top_sectors_by_rev_growth: Array<{ sector: string; revenue_yoy: number | null; companies_reported: number }>;
}

export default function SummaryCards({ data }: { data: SummaryData | null }) {
  if (!data) return <SummarySkeleton />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Stat
        label="Companies reported"
        value={`${data.companies_reported} / ${data.companies_tracked}`}
        hint={data.quarter ? `for ${data.quarter}` : "no data yet"}
      />
      <Stat
        label="Avg revenue growth (YoY)"
        value={formatPct(data.avg_revenue_yoy)}
        valueClass={pctToneClass(data.avg_revenue_yoy)}
      />
      <Stat
        label="Avg net profit growth (YoY)"
        value={formatPct(data.avg_profit_yoy)}
        valueClass={pctToneClass(data.avg_profit_yoy)}
      />
      <div className="card p-5">
        <div className="text-[11px] uppercase tracking-wide text-core-muted">Top sectors · revenue YoY</div>
        {data.top_sectors_by_rev_growth.length === 0 ? (
          <div className="mt-2 text-sm text-core-muted">—</div>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {data.top_sectors_by_rev_growth.slice(0, 3).map((s) => (
              <li key={s.sector} className="flex items-baseline justify-between gap-3">
                <span className="truncate">{s.sector}</span>
                <span className={`font-medium ${pctToneClass(s.revenue_yoy)}`}>
                  {formatPct(s.revenue_yoy)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint, valueClass }: { label: string; value: string; hint?: string; valueClass?: string }) {
  return (
    <div className="card p-5">
      <div className="text-[11px] uppercase tracking-wide text-core-muted">{label}</div>
      <div className={`mt-2 text-3xl serif tracking-tight ${valueClass ?? ""}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-core-muted">{hint}</div> : null}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {[0,1,2,3].map((i) => (
        <div key={i} className="card p-5">
          <div className="skeleton h-3 w-28" />
          <div className="skeleton h-8 w-32 mt-3" />
          <div className="skeleton h-3 w-20 mt-2" />
        </div>
      ))}
    </div>
  );
}
