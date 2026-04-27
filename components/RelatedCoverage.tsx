"use client";

import { useEffect, useState } from "react";

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
// Relative time label
//
//   < 30 min  → "Recent"
//   < 2 hrs   → "1 hr ago"
//   < 24 hrs  → "X hrs ago"
//   ≥ 24 hrs  → "Yesterday"
// ---------------------------------------------------------------------------
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMs = Date.now() - t;
  if (diffMs < 0) return "Recent";                         // future-dated (edge case)
  const mins = Math.round(diffMs / 60_000);
  if (mins < 30) return "Recent";
  const hrs = Math.floor(diffMs / 3_600_000);
  if (hrs < 2)  return "1 hr ago";
  if (hrs < 24) return `${hrs} hrs ago`;
  return "Yesterday";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function RelatedCoverage() {
  const [items, setItems]   = useState<CoverageItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/related-coverage")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && Array.isArray(j.data)) setItems(j.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mt-6 border-t border-core-line pt-5">
      {/* Section label — matches "Outlier signals" style */}
      <div className="text-[10px] md:text-[11px] uppercase tracking-[0.2em] text-core-ink font-bold mb-3">
        Related Coverage
      </div>

      {/* Fixed-height card with internal scroll */}
      <div
        className="border border-core-line rounded-lg overflow-hidden bg-white"
        style={{ height: "clamp(240px, 28vw, 300px)" }}
      >
        <div className="h-full overflow-y-auto no-scrollbar">

          {loading ? (
            /* Loading skeleton — two ghost lines */
            <div className="px-4 py-5 space-y-4">
              {[1, 2].map((n) => (
                <div key={n} className="flex gap-3 animate-pulse">
                  <div className="h-3 w-14 bg-gray-100 rounded shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-gray-100 rounded w-4/5" />
                    <div className="h-3 bg-gray-100 rounded w-2/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            /* Empty state */
            <div className="flex h-full items-center justify-center px-6 text-center">
              <p className="text-[12px] text-core-muted leading-relaxed max-w-xs">
                Related coverage will appear as relevant stories are found.
              </p>
            </div>
          ) : (
            /* Timeline list — newest first */
            <ul className="divide-y divide-core-line">
              {items.map((item) => {
                const timeLabel = relativeTime(item.published_at);
                // Use commentary (≤ 20 words, cleaned) if available, else title.
                const headline = (item.commentary || item.title).trim();
                const context  = item.matched_company || item.matched_sector;

                return (
                  <li
                    key={item.id}
                    className="px-4 py-3 hover:bg-gray-50/60 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* Relative time — left column, fixed width */}
                      {timeLabel ? (
                        <span className="shrink-0 mt-[3px] text-[10px] uppercase tracking-[0.12em] text-core-muted font-medium w-[4.5rem] leading-none">
                          {timeLabel}
                        </span>
                      ) : (
                        <span className="shrink-0 w-[4.5rem]" />
                      )}

                      {/* Headline + source link */}
                      <div className="min-w-0 flex-1">
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] leading-snug text-core-ink hover:text-core-pink transition-colors"
                        >
                          {headline}
                          <span className="text-core-muted whitespace-nowrap">
                            {" — "}{item.source_name}{" ↗"}
                          </span>
                        </a>

                        {/* Context tag — sector or company match */}
                        {context ? (
                          <div className="mt-0.5 text-[10px] text-core-muted truncate">
                            {context}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

        </div>
      </div>
    </div>
  );
}
