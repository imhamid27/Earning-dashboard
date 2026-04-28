"use client";

import { useEffect, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CoverageItem {
  id: string;
  title: string;
  commentary: string | null;
  source_name: string;
  source_url: string;
  published_at: string | null;
  matched_sector: string | null;
  matched_company: string | null;
  match_reason: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMs = Date.now() - t;
  if (diffMs < 0) return "Just now";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 30) return "Just now";
  const hrs = Math.floor(diffMs / 3_600_000);
  if (hrs < 2)  return "1 hr ago";
  if (hrs < 24) return `${hrs} hrs ago`;
  const days = Math.floor(diffMs / 86_400_000);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

// Tier 1 → solid/vivid   Tier 2 → medium   Tier 3 → muted
function sourceDot(name: string): string {
  const n = name.toLowerCase();
  // Tier 1
  if (n.includes("the core"))          return "bg-violet-600";   // credibility 100
  // Tier 2
  if (n.includes("reuters"))           return "bg-orange-500";   // credibility 95
  if (n.includes("bloomberg"))         return "bg-purple-600";   // credibility 90
  if (n.includes("business standard")) return "bg-blue-600";     // credibility 88
  if (n.includes("mint"))              return "bg-emerald-500";  // credibility 85
  if (n.includes("economic times"))    return "bg-red-500";      // credibility 82
  // Tier 3
  if (n.includes("cnbc"))              return "bg-sky-500";      // credibility 78
  if (n.includes("moneycontrol"))      return "bg-amber-500";    // credibility 75
  // Fallback
  if (n.includes("ndtv"))              return "bg-red-600";
  return "bg-gray-400";
}

// ---------------------------------------------------------------------------
// Refresh icon — clean stroke-based circular arrow
// ---------------------------------------------------------------------------
function IconRefresh({ spinning }: { spinning: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-3.5 h-3.5 ${spinning ? "animate-spin" : ""}`}
      style={{ animationDuration: "0.7s" }}
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.18-3.4" />
      <polyline points="12.5 1.5 12.5 4.5 9.5 4.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Single story card — Inshorts style
//
//  [Headline]
//  [AI brief — 2-3 sentences]
//  [● Source ↗]   [Sector tag]   [time]
// ---------------------------------------------------------------------------
function StoryCard({ item }: { item: CoverageItem }) {
  const time    = relativeTime(item.published_at);
  const label   = item.matched_company || item.matched_sector;

  // commentary holds the AI-generated brief; fall back to the title if empty
  const brief   = item.commentary?.trim() || "";
  const showBrief = brief.length > 20 && brief.toLowerCase() !== item.title.toLowerCase().slice(0, brief.length);

  return (
    <li className="px-4 py-4 hover:bg-gray-50/60 transition-colors group">

      {/* Headline */}
      <a
        href={item.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-[13.5px] font-semibold leading-snug text-core-ink
                   group-hover:text-core-pink transition-colors line-clamp-2"
      >
        {item.title}
      </a>

      {/* AI brief — 2-3 sentences */}
      {showBrief && (
        <p className="mt-1.5 text-[12.5px] leading-[1.55] text-gray-500 line-clamp-3">
          {brief}
        </p>
      )}

      {/* Footer row */}
      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        {/* Source link */}
        <a
          href={item.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[11.5px] font-medium
                     text-core-muted hover:text-core-pink transition-colors"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sourceDot(item.source_name)}`} />
          {item.source_name}
          <span className="opacity-50 text-[10px]">↗</span>
        </a>

        {/* Sector / company tag */}
        {label && (
          <>
            <span className="text-gray-200 text-[10px] select-none">|</span>
            <span className="text-[11px] text-core-muted/80 bg-gray-50 border border-gray-100
                             px-1.5 py-0.5 rounded-full leading-none">
              {label}
            </span>
          </>
        )}

        {/* Spacer + time */}
        {time && (
          <span className="ml-auto text-[11px] text-core-muted/60 tabular-nums shrink-0">
            {time}
          </span>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function RelatedCoverage() {
  const [items, setItems]       = useState<CoverageItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [spinning, setSpinning] = useState(false);

  const load = useCallback((showSpin = false) => {
    if (showSpin) {
      setSpinning(true);
    } else {
      setLoading(true);
    }
    fetch("/api/related-coverage")
      .then((r) => r.json())
      .then((j) => { if (j.ok && Array.isArray(j.data)) setItems(j.data); })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        if (showSpin) setTimeout(() => setSpinning(false), 700);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="mt-6 border-t border-core-line pt-5">

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] md:text-[11.5px] uppercase tracking-[0.2em] text-core-ink font-bold">
          In Context
        </span>
        <button
          onClick={() => load(true)}
          disabled={spinning}
          aria-label="Refresh stories"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium
                     text-core-muted hover:text-core-ink hover:bg-gray-100
                     disabled:opacity-40 transition-all"
        >
          <IconRefresh spinning={spinning} />
          Refresh
        </button>
      </div>

      {/* Card */}
      <div
        className="border border-core-line rounded-xl overflow-hidden bg-white shadow-sm"
        style={{ height: "clamp(260px, 30vw, 380px)" }}
      >
        <div className="h-full overflow-y-auto thin-scrollbar">

          {loading ? (
            <div className="px-4 py-4 space-y-5">
              {[1, 2, 3].map((n) => (
                <div key={n} className="animate-pulse space-y-2">
                  <div className="h-3.5 bg-gray-100 rounded w-full" />
                  <div className="h-3.5 bg-gray-100 rounded w-3/4" />
                  <div className="h-3   bg-gray-100 rounded w-full" />
                  <div className="h-3   bg-gray-100 rounded w-4/5" />
                  <div className="h-3   bg-gray-100 rounded w-3/5" />
                  <div className="flex justify-between mt-1">
                    <div className="h-2.5 bg-gray-100 rounded w-28" />
                    <div className="h-2.5 bg-gray-100 rounded w-12" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
              <svg className="w-8 h-8 text-gray-200" fill="none" viewBox="0 0 24 24"
                   stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0
                     1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5
                     7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125
                     -1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0
                     002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
              </svg>
              <p className="text-[13px] text-core-muted leading-relaxed max-w-[220px]">
                Relevant stories will appear here as they are found.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-core-line/70">
              {items.map((item) => <StoryCard key={item.id} item={item} />)}
            </ul>
          )}

        </div>
      </div>
    </div>
  );
}
