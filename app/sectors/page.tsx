"use client";

/**
 * Sector Snapshot — Corporate Earnings Dashboard
 *
 * Insight-first sector page. Answers in 5–10 seconds:
 *   – Which sectors are strong / mixed / weak?
 *   – What is driving or dragging performance?
 *   – Who are the top/weak companies inside each sector?
 *
 * Layout:
 *   [Masthead + quarter picker]
 *   [Highlight strip: best / weakest / most-declared]
 *   [Sort pills: Profit YoY | Revenue YoY | Declaration %]
 *   [Sector card grid — 2-3 per row]
 *   [Sector deep-dive panels — collapsed; scroll-to on card click]
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import InfoTooltip from "@/components/InfoTooltip";
import JsonLd from "@/components/JsonLd";
import { DISCLAIMER_SHORT } from "@/lib/disclaimer";
import { siteUrl } from "@/lib/site";
import { TURNED_PROFITABLE, TURNED_LOSS_MAKING } from "@/lib/growth";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiSector {
  sector: string;
  companies_reported: number;
  total_revenue: number;
  total_net_profit: number;
  revenue_yoy: number | null;
  profit_yoy: number | null;
}

interface DashRow {
  ticker: string;
  company_name: string;
  sector: string | null;
  status: string | null;
  revenue: number | null;
  net_profit: number | null;
  revenue_yoy: number | null;
  profit_yoy: number | null;
}

type Verdict = "Strong" | "Mixed" | "Weak" | "—";
type SortKey = "profit" | "revenue" | "declared";

interface EnrichedSector extends ApiSector {
  verdict: Verdict;
  insight: string;
  lowBase: boolean;
  totalTracked: number;
  scheduledCount: number;
  topMovers: DashRow[];
  weakMovers: DashRow[];
  allFiled: DashRow[];
  capHeavy: "Large-cap heavy" | null;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const SENTINELS = new Set([TURNED_PROFITABLE, TURNED_LOSS_MAKING]);

/** Signed % without an arrow glyph. "+12.3%" / "−8.1%" / "*low base" */
function fmtPct(v: number | null, digits = 1): string {
  if (v == null) return "—";
  if (v === TURNED_PROFITABLE)  return "Turned profitable";
  if (v === TURNED_LOSS_MAKING) return "Turned loss-making";
  if (Math.abs(v) > 9.99) return "*low base";
  const abs = (Math.abs(v) * 100).toFixed(digits);
  return v > 0 ? `+${abs}%` : `−${abs}%`;
}

function toneClass(v: number | null): string {
  if (v == null) return "text-core-muted";
  if (v === TURNED_PROFITABLE || v > 0)  return "text-core-teal";
  if (v === TURNED_LOSS_MAKING || v < 0) return "text-core-negative";
  return "text-core-muted";
}

function shortName(raw: string): string {
  return raw
    .replace(/\s+(Limited|Ltd\.?|Inc\.?|Corporation|Industries|Company|Services?|Enterprise[s]?)\b.*$/i, "")
    .trim()
    .slice(0, 22);
}

/**
 * Sector verdict (spec-exact):
 *   Strong → rev >10% AND profit >15%
 *   Weak   → profit <0 OR both declining
 *   Mixed  → everything else
 */
function sectorVerdict(rv: number | null, pv: number | null): Verdict {
  if (rv == null && pv == null) return "—";
  if (pv === TURNED_PROFITABLE) return "Strong";
  if (pv === TURNED_LOSS_MAKING) return "Weak";
  const pvN = pv != null && !SENTINELS.has(pv) ? pv : null;
  const rvN = rv != null && !SENTINELS.has(rv) ? rv : null;
  if (rvN != null && pvN != null && rvN > 0.10 && pvN > 0.15) return "Strong";
  if (pvN != null && pvN < 0) return "Weak";
  if (rvN != null && pvN != null && rvN < 0 && pvN < 0) return "Weak";
  return "Mixed";
}

/**
 * Auto-generated 12–15 word sector insight.
 * Data-driven, never generic — includes actual % numbers when safe.
 */
function genInsight(rv: number | null, pv: number | null, verdict: Verdict): string {
  if (rv == null && pv == null) return "Insufficient data for this quarter";
  if (pv === TURNED_PROFITABLE)  return "Sector returned to collective profitability this quarter";
  if (pv === TURNED_LOSS_MAKING) return "Aggregate profitability turning negative this quarter";

  const lowBase =
    (pv != null && !SENTINELS.has(pv) && Math.abs(pv) > 3) ||
    (rv != null && !SENTINELS.has(rv) && Math.abs(rv) > 3);

  if (lowBase) {
    return verdict === "Strong"
      ? "Strong recovery, partly aided by a weak prior-year comparison"
      : "Decline amplified by a high prior-year comparison base";
  }

  const rvA = rv != null ? Math.abs(rv * 100).toFixed(0) : null;
  const pvA = pv != null ? Math.abs(pv * 100).toFixed(0) : null;

  if (verdict === "Strong") {
    if (pv != null && rv != null && pv > rv + 0.08 && rv > 0)
      return `Profit (+${pvA}%) outpacing revenue (+${rvA}%) — margins are expanding`;
    if (rvA && pvA) return `Revenue +${rvA}%, profit +${pvA}% — broad-based sector strength`;
    if (pvA)        return `Profit +${pvA}% YoY — solid quarter for the sector`;
    return          `Revenue +${rvA}% YoY — healthy top-line growth sector-wide`;
  }

  if (verdict === "Weak") {
    if (rv != null && rv > 0.04 && pv != null && pv < -0.08)
      return `Revenue +${rvA}% but profit −${pvA}% — margin squeeze sector-wide`;
    if (rv != null && rv < 0 && pv != null && pv < 0)
      return `Revenue −${rvA}% and profit −${pvA}% — broad contraction sector-wide`;
    if (pvA) return `Profit down ${pvA}% — challenging quarter sector-wide`;
    return   `Revenue declining — top-line pressure across the sector`;
  }

  // Mixed
  if (rv != null && rv > 0.03 && pv != null && pv < -0.03)
    return `Revenue +${rvA}% but profit −${pvA}% — margins under pressure`;
  if (rv != null && rv < -0.03 && pv != null && pv > 0.03)
    return `Profit +${pvA}% despite revenue −${rvA}% — efficiency-led gains`;
  if (rvA && pvA)
    return `Revenue ${rv! > 0 ? "+" : "−"}${rvA}%, profit ${pv! > 0 ? "+" : "−"}${pvA}% — mixed picture`;
  return "Mixed trends — divergent performance across companies";
}

function toSortNum(v: number | null): number {
  if (v == null)                    return -Infinity;
  if (v === TURNED_PROFITABLE)      return 10_000;
  if (v === TURNED_LOSS_MAKING)     return -10_000;
  return v;
}

// ─── Schema LD ───────────────────────────────────────────────────────────────

const BASE = siteUrl();
const SECTORS_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Dashboard", item: `${BASE}/` },
    { "@type": "ListItem", position: 2, name: "Sector snapshot", item: `${BASE}/sectors` },
  ],
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SectorsPage() {
  const [quarters, setQuarters]     = useState<string[]>([]);
  const [quarter,  setQuarter]      = useState<string | null>(null);
  const [rawSectors, setRawSectors] = useState<ApiSector[]>([]);
  const [dashRows,   setDashRows]   = useState<DashRow[]>([]);
  const [sort,    setSort]          = useState<SortKey>("profit");
  const [openDive, setOpenDive]     = useState<string | null>(null);
  const [loading,  setLoading]      = useState(true);

  // Quarter list + smart default
  useEffect(() => {
    Promise.all([
      fetch("/api/quarters").then((r) => r.json()),
      fetch("/api/best-quarter?min=100").then((r) => r.json()),
    ]).then(([qs, best]) => {
      if (qs.ok) setQuarters(qs.data ?? []);
      const pick = best?.ok ? best.data?.best?.quarter_label : null;
      setQuarter(pick ?? qs.data?.[0] ?? null);
    });
  }, []);

  // Data fetch — sectors aggregates + full company list
  useEffect(() => {
    if (!quarter) return;
    setLoading(true);
    setOpenDive(null);
    Promise.all([
      fetch(`/api/sectors?quarter=${encodeURIComponent(quarter)}`).then((r) => r.json()),
      fetch(`/api/dashboard?quarter=${encodeURIComponent(quarter)}`).then((r) => r.json()),
    ]).then(([sec, dash]) => {
      setRawSectors(sec.ok  ? (sec.data?.sectors  ?? []) : []);
      if (dash.ok) {
        setDashRows(
          (dash.data?.rows ?? []).map((r: any): DashRow => ({
            ticker:       r.ticker,
            company_name: r.company_name,
            sector:       r.sector   ?? null,
            status:       r.status   ?? null,
            revenue:      r.revenue  ?? null,
            net_profit:   r.net_profit ?? null,
            revenue_yoy:  r.revenue_yoy  ?? null,
            profit_yoy:   r.profit_yoy   ?? null,
          }))
        );
      }
      setLoading(false);
    });
  }, [quarter]);

  // Enrich: merge sector aggregates with per-company data
  const enriched = useMemo((): EnrichedSector[] => {
    const bySector = new Map<string, DashRow[]>();
    for (const r of dashRows) {
      const s = r.sector ?? "Other";
      if (!bySector.has(s)) bySector.set(s, []);
      bySector.get(s)!.push(r);
    }

    return rawSectors.map((s): EnrichedSector => {
      const companies    = bySector.get(s.sector) ?? [];
      const totalTracked = companies.length;
      const scheduledCount = companies.filter((c) => c.status === "scheduled").length;

      // Companies that have actually filed with numbers
      const filed = companies
        .filter((c) => c.status === "announced_with_numbers")
        .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));

      // Top/weak movers sorted by profit_yoy
      const byProfit = [...filed].sort((a, b) => toSortNum(b.profit_yoy) - toSortNum(a.profit_yoy));
      const topMovers  = byProfit.slice(0, 2);
      const weakMovers = [...byProfit].reverse().slice(0, 2).filter((c) => !topMovers.includes(c));

      // Large-cap concentration: top 3 by revenue > 60% of sector total
      const top3Rev = [...filed]
        .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
        .slice(0, 3)
        .reduce((sum, c) => sum + (c.revenue ?? 0), 0);
      const capHeavy: "Large-cap heavy" | null =
        s.total_revenue > 0 && top3Rev / s.total_revenue > 0.60 ? "Large-cap heavy" : null;

      const verdict  = sectorVerdict(s.revenue_yoy, s.profit_yoy);
      const lowBase  =
        (s.profit_yoy != null && !SENTINELS.has(s.profit_yoy) && Math.abs(s.profit_yoy) > 3) ||
        (s.revenue_yoy != null && Math.abs(s.revenue_yoy) > 3);

      return {
        ...s,
        verdict,
        insight: genInsight(s.revenue_yoy, s.profit_yoy, verdict),
        lowBase,
        totalTracked,
        scheduledCount,
        topMovers,
        weakMovers,
        allFiled: filed,
        capHeavy,
      };
    });
  }, [rawSectors, dashRows]);

  // Sort
  const sorted = useMemo((): EnrichedSector[] => {
    return [...enriched].sort((a, b) => {
      if (sort === "revenue")
        return toSortNum(b.revenue_yoy) - toSortNum(a.revenue_yoy);
      if (sort === "declared") {
        const ap = a.totalTracked > 0 ? a.companies_reported / a.totalTracked : 0;
        const bp = b.totalTracked > 0 ? b.companies_reported / b.totalTracked : 0;
        return bp - ap;
      }
      return toSortNum(b.profit_yoy) - toSortNum(a.profit_yoy); // profit (default)
    });
  }, [enriched, sort]);

  // Highlight strip data
  const highlights = useMemo(() => {
    const withData = enriched.filter(
      (s) => s.profit_yoy != null && !SENTINELS.has(s.profit_yoy as number)
    );
    if (!withData.length) return null;
    const byP = [...withData].sort((a, b) => toSortNum(b.profit_yoy) - toSortNum(a.profit_yoy));
    const best  = byP[0];
    const worst = byP[byP.length - 1];
    const mostDeclared = [...enriched].sort((a, b) => {
      const ap = a.totalTracked > 0 ? a.companies_reported / a.totalTracked : 0;
      const bp = b.totalTracked > 0 ? b.companies_reported / b.totalTracked : 0;
      return bp - ap;
    })[0];
    return { best, worst, mostDeclared };
  }, [enriched]);

  // Card click → open dive + smooth scroll
  const handleCardClick = useCallback(
    (sector: string) => {
      const next = openDive === sector ? null : sector;
      setOpenDive(next);
      if (next) {
        setTimeout(() => {
          document
            .getElementById(`dive-${CSS.escape(next)}`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      }
    },
    [openDive]
  );

  return (
    <div className="container-core py-8 md:py-12 pb-20">
      <JsonLd data={SECTORS_LD} />

      {/* ── Masthead ── */}
      <section className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b border-core-line pb-6 mb-6">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-core-muted font-semibold">
            Corporate Earnings Dashboard
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tightest mt-1">
            Sector snapshot
            <span className="inline-block align-middle ml-2 -translate-y-0.5">
              <InfoTooltip text={DISCLAIMER_SHORT} size="md" />
            </span>
          </h1>
          <p className="text-[13px] text-core-muted mt-2 max-w-xl leading-snug">
            Where earnings strength or weakness is concentrated — profit and revenue growth by sector,{" "}
            {quarter ?? "current quarter"}.
          </p>
        </div>
        <label className="flex items-center gap-2.5 text-[10px] uppercase tracking-[0.14em] text-core-muted shrink-0">
          Quarter
          <select
            value={quarter ?? ""}
            onChange={(e) => setQuarter(e.target.value || null)}
            className="border border-core-line bg-white text-xs px-3 py-2 rounded-md normal-case text-core-ink font-semibold focus:outline-none focus:border-core-pink"
          >
            {quarters.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </label>
      </section>

      {/* ── Highlight strip ── */}
      {highlights && !loading ? (
        <div className="mb-6 py-3 border-b border-core-line flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <span>
            <span className="text-[9px] uppercase tracking-[0.2em] text-core-muted font-semibold mr-2">Best</span>
            <span className="font-bold text-core-teal">{highlights.best.sector}</span>
            <span className="text-core-muted text-[12px] ml-1.5">
              ({fmtPct(highlights.best.profit_yoy)} profit)
            </span>
          </span>
          <span className="text-core-line hidden sm:inline">·</span>
          <span>
            <span className="text-[9px] uppercase tracking-[0.2em] text-core-muted font-semibold mr-2">Weakest</span>
            <span className="font-bold text-core-negative">{highlights.worst.sector}</span>
            <span className="text-core-muted text-[12px] ml-1.5">
              ({fmtPct(highlights.worst.profit_yoy)} profit)
            </span>
          </span>
          <span className="text-core-line hidden sm:inline">·</span>
          <span>
            <span className="text-[9px] uppercase tracking-[0.2em] text-core-muted font-semibold mr-2">Most declared</span>
            <span className="font-bold text-core-ink">{highlights.mostDeclared.sector}</span>
            <span className="text-core-muted text-[12px] ml-1.5">
              ({highlights.mostDeclared.companies_reported}
              {highlights.mostDeclared.totalTracked > 0
                ? `/${highlights.mostDeclared.totalTracked}`
                : ""} companies)
            </span>
          </span>
        </div>
      ) : null}

      {/* ── Sort controls ── */}
      {!loading ? (
        <div className="mb-6 flex items-center flex-wrap gap-2">
          <span className="text-[10px] uppercase tracking-[0.2em] text-core-muted font-semibold mr-1">
            Sort by
          </span>
          {(["profit", "revenue", "declared"] as SortKey[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
                sort === s
                  ? "bg-core-ink text-white border-core-ink"
                  : "border-core-line text-core-muted hover:border-core-ink hover:text-core-ink"
              }`}
            >
              {s === "profit"   ? "Profit YoY"
               : s === "revenue" ? "Revenue YoY"
               : "Declaration %"}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-core-muted tabular-nums">
            {sorted.length} sectors · {quarter}
          </span>
        </div>
      ) : null}

      {/* ── Loading skeleton ── */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl border border-core-line p-5 animate-pulse space-y-3.5">
              <div className="flex justify-between items-start">
                <div className="h-4 w-36 bg-core-line rounded" />
                <div className="h-5 w-20 bg-core-line rounded-full" />
              </div>
              <div className="h-1.5 w-full bg-core-line rounded-full" />
              <div className="h-3 w-52 bg-core-line rounded" />
              <div className="flex gap-6 pt-1">
                <div className="space-y-1.5">
                  <div className="h-2 w-16 bg-core-line rounded" />
                  <div className="h-5 w-14 bg-core-line rounded" />
                </div>
                <div className="space-y-1.5">
                  <div className="h-2 w-16 bg-core-line rounded" />
                  <div className="h-5 w-14 bg-core-line rounded" />
                </div>
              </div>
              <div className="pt-2 border-t border-core-line h-3 w-40 bg-core-line rounded" />
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Sector card grid ── */}
      {!loading && sorted.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-10">
          {sorted.map((s) => (
            <SectorCard
              key={s.sector}
              s={s}
              isOpen={openDive === s.sector}
              onClick={() => handleCardClick(s.sector)}
            />
          ))}
        </div>
      ) : null}

      {!loading && sorted.length === 0 ? (
        <div className="py-16 text-center text-core-muted text-[14px]">
          No sector data for {quarter ?? "this quarter"}.
        </div>
      ) : null}

      {/* ── Deep-dive panels (all rendered for scroll targets, collapsed unless open) ── */}
      {!loading
        ? sorted.map((s) => (
            <SectorDeepDive
              key={s.sector}
              s={s}
              quarter={quarter}
              isOpen={openDive === s.sector}
              onClose={() => setOpenDive(null)}
            />
          ))
        : null}
    </div>
  );
}

// ─── Verdict badge ────────────────────────────────────────────────────────────

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const styles: Record<Verdict, { wrap: string; dot: string }> = {
    Strong: { wrap: "bg-core-teal/10 text-core-teal",         dot: "bg-core-teal" },
    Mixed:  { wrap: "bg-amber-50 text-amber-700",             dot: "bg-amber-400" },
    Weak:   { wrap: "bg-core-negative/10 text-core-negative", dot: "bg-core-negative" },
    "—":    { wrap: "bg-core-line text-core-muted",           dot: "bg-core-muted/40" },
  };
  const { wrap, dot } = styles[verdict];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.12em] shrink-0 ${wrap}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
      {verdict === "—" ? "No data" : `${verdict} quarter`}
    </span>
  );
}

// ─── 3-part progress bar ──────────────────────────────────────────────────────

function ProgressBar({
  reported, scheduled, total,
}: { reported: number; scheduled: number; total: number }) {
  const max = Math.max(total, reported, 1);
  const rW  = Math.max(Math.round((reported  / max) * 100), reported  > 0 ? 4 : 0);
  const sW  = Math.max(Math.round((scheduled / max) * 100), scheduled > 0 ? 4 : 0);
  const gW  = Math.max(100 - rW - sW, 0);
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden gap-px w-full bg-core-line">
      {rW > 0 && <div className="bg-core-teal rounded-l-full"   style={{ width: `${rW}%` }} />}
      {sW > 0 && <div className="bg-amber-400"                  style={{ width: `${sW}%` }} />}
      {gW > 0 && <div className="bg-core-line rounded-r-full"   style={{ width: `${gW}%` }} />}
    </div>
  );
}

// ─── Sector card ──────────────────────────────────────────────────────────────

function SectorCard({
  s, isOpen, onClick,
}: { s: EnrichedSector; isOpen: boolean; onClick: () => void }) {
  const declaredLabel =
    s.totalTracked > 0
      ? `${s.companies_reported} / ${s.totalTracked} declared`
      : `${s.companies_reported} declared`;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-5 transition-all duration-150 group ${
        isOpen
          ? "border-core-ink bg-core-surface shadow-sm"
          : "border-core-line bg-white hover:border-core-ink/40 hover:shadow-sm"
      }`}
    >
      {/* Row 1 — name + verdict */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="font-bold text-[15px] md:text-[16px] text-core-ink leading-tight tracking-tightest">
          {s.sector}
        </div>
        <VerdictBadge verdict={s.verdict} />
      </div>

      {/* Row 2 — declaration count + cap label */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-core-muted tabular-nums">{declaredLabel}</span>
        {s.capHeavy ? (
          <span className="text-[10px] text-core-muted">{s.capHeavy}</span>
        ) : null}
      </div>

      {/* Progress bar: green=reported, amber=scheduled, grey=rest */}
      <div className="mb-4">
        <ProgressBar
          reported={s.companies_reported}
          scheduled={s.scheduledCount}
          total={Math.max(s.totalTracked, s.companies_reported)}
        />
        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-core-muted">
          {s.companies_reported > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-1.5 rounded-sm bg-core-teal" />
              Reported
            </span>
          )}
          {s.scheduledCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-1.5 rounded-sm bg-amber-400" />
              Pending
            </span>
          )}
          {s.totalTracked > s.companies_reported + s.scheduledCount && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-1.5 rounded-sm bg-core-line" />
              Awaiting
            </span>
          )}
        </div>
      </div>

      {/* Insight line */}
      <p className="text-[12px] text-core-muted leading-snug mb-4 italic">
        {s.insight}
        {s.lowBase ? (
          <span className="not-italic text-[10px] ml-1 text-core-muted/70">*low base</span>
        ) : null}
      </p>

      {/* Key metrics */}
      <div className="flex items-stretch gap-0 mb-4">
        <div className="flex-1 border-r border-core-line pr-4">
          <div className="text-[9px] uppercase tracking-[0.16em] text-core-muted mb-1">
            Revenue YoY
          </div>
          <div className={`text-[16px] font-extrabold tabular-nums leading-none ${toneClass(s.revenue_yoy)}`}>
            {fmtPct(s.revenue_yoy)}
          </div>
        </div>
        <div className="flex-1 pl-4">
          <div className="text-[9px] uppercase tracking-[0.16em] text-core-muted mb-1">
            Profit YoY
          </div>
          <div className={`text-[16px] font-extrabold tabular-nums leading-none ${toneClass(s.profit_yoy)}`}>
            {fmtPct(s.profit_yoy)}
          </div>
        </div>
      </div>

      {/* Top / Weak movers */}
      {(s.topMovers.length > 0 || s.weakMovers.length > 0) ? (
        <div className="pt-3 border-t border-core-line space-y-1.5">
          {s.topMovers.length > 0 && (
            <div className="flex items-baseline gap-1.5 text-[11px]">
              <span className="text-core-teal font-bold shrink-0">▲</span>
              <span className="text-core-muted shrink-0">Top:</span>
              <span className="font-semibold text-core-ink truncate">
                {s.topMovers.map((c) => shortName(c.company_name)).join(", ")}
              </span>
            </div>
          )}
          {s.weakMovers.length > 0 && (
            <div className="flex items-baseline gap-1.5 text-[11px]">
              <span className="text-core-negative font-bold shrink-0">▼</span>
              <span className="text-core-muted shrink-0">Weak:</span>
              <span className="font-semibold text-core-ink truncate">
                {s.weakMovers.map((c) => shortName(c.company_name)).join(", ")}
              </span>
            </div>
          )}
        </div>
      ) : null}

      {/* Expand cue */}
      <div
        className={`mt-3.5 flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] transition-colors ${
          isOpen ? "text-core-ink font-semibold" : "text-core-muted group-hover:text-core-ink"
        }`}
      >
        <span>{isOpen ? "↑ Close" : "↓ Sector detail"}</span>
      </div>
    </button>
  );
}

// ─── Sector deep-dive ─────────────────────────────────────────────────────────

function SectorDeepDive({
  s, quarter, isOpen, onClose,
}: {
  s: EnrichedSector;
  quarter: string | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [showAll, setShowAll] = useState(false);

  // Collapse "view all" list when dive is closed
  if (!isOpen) {
    return <div id={`dive-${CSS.escape(s.sector)}`} />;
  }

  const topPerfs  = [...s.allFiled]
    .sort((a, b) => toSortNum(b.profit_yoy) - toSortNum(a.profit_yoy))
    .slice(0, 4);
  const weakPerfs = [...s.allFiled]
    .sort((a, b) => toSortNum(a.profit_yoy) - toSortNum(b.profit_yoy))
    .slice(0, 3)
    .filter((c) => !topPerfs.includes(c));

  const PAGE = 8;
  const displayList = showAll ? s.allFiled : s.allFiled.slice(0, PAGE);
  const remainder   = s.allFiled.length - PAGE;

  return (
    <div
      id={`dive-${CSS.escape(s.sector)}`}
      className="mb-6 rounded-xl border border-core-line overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-core-line bg-core-surface">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.22em] text-core-muted font-semibold mb-0.5">
              {quarter}
            </div>
            <h2 className="text-[20px] font-extrabold tracking-tightest text-core-ink leading-tight truncate">
              {s.sector}
            </h2>
          </div>
          <VerdictBadge verdict={s.verdict} />
        </div>
        <button
          onClick={onClose}
          aria-label="Close sector detail"
          className="shrink-0 w-7 h-7 rounded-full border border-core-line flex items-center justify-center text-core-muted hover:text-core-ink hover:border-core-ink transition-colors text-[13px]"
        >
          ✕
        </button>
      </div>

      <div className="px-5 py-5 space-y-6">
        {/* Sector story */}
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-core-muted font-semibold mb-2">
            Sector story
          </div>
          <p className="text-[14px] text-core-ink leading-snug mb-3">
            {s.insight}
            {s.lowBase ? (
              <span className="text-core-muted text-[12px] ml-2">
                *Low base effect may be amplifying YoY numbers.
              </span>
            ) : null}
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
            <span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-core-muted mr-1.5">Revenue</span>
              <span className={`font-bold ${toneClass(s.revenue_yoy)}`}>{fmtPct(s.revenue_yoy)}</span>
            </span>
            <span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-core-muted mr-1.5">Profit</span>
              <span className={`font-bold ${toneClass(s.profit_yoy)}`}>{fmtPct(s.profit_yoy)}</span>
            </span>
            <span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-core-muted mr-1.5">Declared</span>
              <span className="font-bold text-core-ink">
                {s.companies_reported}
                {s.totalTracked > 0 ? ` / ${s.totalTracked}` : ""} companies
              </span>
            </span>
          </div>
        </div>

        {/* Top and Weak performers side-by-side */}
        {(topPerfs.length > 0 || weakPerfs.length > 0) ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x divide-core-line gap-y-5">
            {topPerfs.length > 0 && (
              <div className="sm:pr-6">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="inline-block w-2 h-2 rounded-sm bg-core-teal shrink-0" />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-core-ink font-bold">
                    Top performers
                  </span>
                </div>
                <div className="divide-y divide-core-line">
                  {topPerfs.map((c) => (
                    <div key={c.ticker} className="flex justify-between items-start py-2.5 gap-2">
                      <Link
                        href={`/company/${encodeURIComponent(c.ticker)}`}
                        className="text-[13px] font-medium hover:text-core-pink truncate min-w-0"
                      >
                        {shortName(c.company_name)}
                      </Link>
                      <div className="text-right shrink-0">
                        <div className={`text-[12px] font-bold ${toneClass(c.profit_yoy)}`}>
                          {fmtPct(c.profit_yoy)}
                        </div>
                        <div className="text-[11px] text-core-muted">profit</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {weakPerfs.length > 0 && (
              <div className="sm:pl-6">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="inline-block w-2 h-2 rounded-sm bg-core-negative shrink-0" />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-core-ink font-bold">
                    Underperformers
                  </span>
                </div>
                <div className="divide-y divide-core-line">
                  {weakPerfs.map((c) => (
                    <div key={c.ticker} className="flex justify-between items-start py-2.5 gap-2">
                      <Link
                        href={`/company/${encodeURIComponent(c.ticker)}`}
                        className="text-[13px] font-medium hover:text-core-pink truncate min-w-0"
                      >
                        {shortName(c.company_name)}
                      </Link>
                      <div className="text-right shrink-0">
                        <div className={`text-[12px] font-bold ${toneClass(c.profit_yoy)}`}>
                          {fmtPct(c.profit_yoy)}
                        </div>
                        <div className="text-[11px] text-core-muted">profit</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* All companies — collapsed list with "View all" toggle */}
        {s.allFiled.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-[10px] uppercase tracking-[0.2em] text-core-muted font-semibold">
                All filed — {s.allFiled.length} companies
              </div>
              {s.allFiled.length > PAGE && (
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="text-[11px] text-core-muted hover:text-core-ink border border-core-line rounded-md px-2.5 py-1 transition-colors"
                >
                  {showAll ? "Show fewer" : `View all ${s.allFiled.length}`}
                </button>
              )}
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-[9px] uppercase tracking-[0.14em] text-core-muted font-semibold border-b border-core-line">
              <div className="col-span-6">Company</div>
              <div className="col-span-3 text-right">Rev YoY</div>
              <div className="col-span-3 text-right">Profit YoY</div>
            </div>

            <div className="divide-y divide-core-line border border-core-line rounded-lg overflow-hidden mt-0.5">
              {displayList.map((c) => (
                <Link
                  key={c.ticker}
                  href={`/company/${encodeURIComponent(c.ticker)}`}
                  className="grid grid-cols-12 gap-2 items-center px-3 py-2.5 hover:bg-core-surface transition-colors group"
                >
                  <div className="col-span-6 min-w-0">
                    <div className="text-[13px] font-medium text-core-ink group-hover:text-core-pink truncate leading-tight">
                      {c.company_name}
                    </div>
                    <div className="text-[10px] text-core-muted tabular-nums">{c.ticker}</div>
                  </div>
                  <div className={`col-span-3 text-right text-[12px] font-semibold tabular-nums ${toneClass(c.revenue_yoy)}`}>
                    {fmtPct(c.revenue_yoy)}
                  </div>
                  <div className={`col-span-3 text-right text-[12px] font-semibold tabular-nums ${toneClass(c.profit_yoy)}`}>
                    {fmtPct(c.profit_yoy)}
                  </div>
                </Link>
              ))}
            </div>

            {!showAll && remainder > 0 ? (
              <button
                onClick={() => setShowAll(true)}
                className="mt-2.5 w-full text-center text-[12px] text-core-muted hover:text-core-ink py-2 border border-core-line rounded-lg transition-colors"
              >
                + {remainder} more companies
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] text-core-muted italic">
            No companies have filed numbers yet for {s.sector} this quarter.
          </p>
        )}
      </div>
    </div>
  );
}
