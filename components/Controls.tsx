"use client";

// Quarter selector, company search, sector filter — the row under the hero.
// Stateless: state is held by the parent dashboard page.
export default function Controls({
  quarters,
  quarter, onQuarter,
  sectors, sector, onSector,
  q, onQ,
  bucket, onBucket
}: {
  quarters: string[];
  quarter: string | null; onQuarter: (q: string | null) => void;
  sectors: string[];     sector: string | null;  onSector: (s: string | null) => void;
  q: string;             onQ: (v: string) => void;
  bucket: string | null; onBucket: (b: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-core-muted mb-1">Quarter</label>
        <select
          className="border border-core-line bg-white text-sm px-3 py-2 rounded-sm focus:outline-none focus:border-core-ink"
          value={quarter ?? ""}
          onChange={(e) => onQuarter(e.target.value || null)}
        >
          <option value="">Latest</option>
          {quarters.map((q) => <option key={q} value={q}>{q}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-core-muted mb-1">Sector</label>
        <select
          className="border border-core-line bg-white text-sm px-3 py-2 rounded-sm focus:outline-none focus:border-core-ink"
          value={sector ?? ""}
          onChange={(e) => onSector(e.target.value || null)}
        >
          <option value="">All sectors</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-core-muted mb-1">Market cap</label>
        <select
          className="border border-core-line bg-white text-sm px-3 py-2 rounded-sm focus:outline-none focus:border-core-ink"
          value={bucket ?? ""}
          onChange={(e) => onBucket(e.target.value || null)}
        >
          <option value="">Any</option>
          <option value="LARGE">Large cap</option>
          <option value="MID">Mid cap</option>
          <option value="SMALL">Small cap</option>
        </select>
      </div>
      <div className="flex-1 min-w-[200px]">
        <label className="block text-[10px] uppercase tracking-wide text-core-muted mb-1">Search company</label>
        <input
          type="search"
          placeholder="e.g. Reliance, HDFC, TCS"
          value={q}
          onChange={(e) => onQ(e.target.value)}
          className="w-full border border-core-line bg-white text-sm px-3 py-2 rounded-sm focus:outline-none focus:border-core-ink"
        />
      </div>
    </div>
  );
}
