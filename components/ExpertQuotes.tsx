"use client";

// ExpertQuotes — Part 6 of the Corporate Earnings Dashboard upgrade.
//
// TRUST RULES (per editorial spec):
//   - Every quote MUST have a source_url pointing to the specific
//     article, earnings-call transcript, or press release it came from.
//   - The API already filters source_url IS NOT NULL — this component
//     adds a second client-side guard so nothing slips through.
//   - The source link is rendered prominently and opens in a new tab.
//   - Block hides entirely when no qualifying quotes exist.
//
// Layout: fixed-height (300px desktop / 250px mobile) scrollable card,
// newest on top, no auto-scroll.

import { useEffect, useState } from "react";
import { formatLastUpdated } from "@/lib/format";
import type { ExpertQuote } from "@/lib/types";

export default function ExpertQuotes() {
  const [quotes, setQuotes] = useState<ExpertQuote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/expert-quotes?limit=5")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          // Client-side guard: only show quotes with a real source_url
          const verified = (j.data.quotes ?? []).filter(
            (q: ExpertQuote) => q.source_url && q.source_url.trim().length > 10
          );
          setQuotes(verified);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Hide block entirely when no verified quotes — spec: "hide if unavailable"
  if (!loading && quotes.length === 0) return null;

  const lastUpdated = quotes[0]?.created_at ?? null;

  return (
    <section className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-core-line">
        <div className="flex items-center gap-2.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-core-ink" />
          <span className="text-[11px] md:text-[12px] uppercase tracking-[0.18em] text-core-ink font-bold">
            Expert speaks
          </span>
        </div>
        {lastUpdated ? (
          <span className="text-[10px] text-core-muted tabular-nums">
            {formatLastUpdated(lastUpdated)}
          </span>
        ) : null}
      </div>

      {/* Scrollable body */}
      <div
        className="overflow-y-auto no-scrollbar"
        style={{ height: "clamp(250px, 30vw, 300px)" }}
      >
        {loading ? (
          <QuotesSkeleton />
        ) : (
          <ul className="divide-y divide-core-line">
            {quotes.map((q) => (
              <QuoteEntry key={q.id} quote={q} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function QuoteEntry({ quote }: { quote: ExpertQuote }) {
  // Initials avatar fallback
  const initials = quote.expert_name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const pubDate = quote.published_date
    ? new Date(quote.published_date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <li className="px-5 py-4 hover:bg-core-surface/50 transition-colors">
      {/* Expert attribution */}
      <div className="flex items-start gap-3 mb-2.5">
        {quote.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={quote.photo_url}
            alt={quote.expert_name}
            className="w-8 h-8 rounded-full object-cover shrink-0 border border-core-line"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-core-ink text-white flex items-center justify-center text-[10px] font-bold shrink-0 select-none">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-core-ink leading-tight">
            {quote.expert_name}
          </div>
          <div className="text-[11px] text-core-muted leading-tight mt-0.5">
            {[quote.designation, quote.firm].filter(Boolean).join(", ")}
          </div>
        </div>
        {quote.quarter ? (
          <span className="text-[10px] text-core-muted shrink-0 tabular-nums">
            {quote.quarter}
          </span>
        ) : null}
      </div>

      {/* Quote text */}
      <blockquote className="text-[13px] text-core-ink leading-snug italic border-l-2 border-core-pink pl-3 mb-2.5">
        &ldquo;{quote.quote}&rdquo;
      </blockquote>

      {/* Source — the most important trust element: always a real link */}
      <a
        href={quote.source_url!}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[10px] text-core-muted hover:text-core-ink transition-colors group"
        title={`Read source: ${quote.source_name ?? quote.source_url}`}
      >
        {/* External link icon */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className="shrink-0 opacity-50 group-hover:opacity-100"
        >
          <path
            d="M5.5 1H9v3.5M9 1 4.5 5.5M1 3h3v6H1V3z"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="truncate max-w-[220px]">
          {quote.source_name ?? "View source"}
        </span>
        {pubDate ? <span className="shrink-0 opacity-70">· {pubDate}</span> : null}
      </a>
    </li>
  );
}

function QuotesSkeleton() {
  return (
    <ul className="divide-y divide-core-line">
      {[...Array(3)].map((_, i) => (
        <li key={i} className="px-5 py-4 animate-pulse">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-core-line shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-32 bg-core-line rounded" />
              <div className="h-2.5 w-24 bg-core-line rounded" />
            </div>
          </div>
          <div className="h-3 w-full bg-core-line rounded mb-1.5" />
          <div className="h-3 w-5/6 bg-core-line rounded mb-1.5" />
          <div className="h-2.5 w-28 bg-core-line rounded" />
        </li>
      ))}
    </ul>
  );
}
