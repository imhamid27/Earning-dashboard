"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

interface Company {
  ticker: string;
  company_name: string;
  sector: string | null;
  bse_scrip?: string | null;
  next_result_date?: string | null;
  industry?: string | null;
}

// Company search — hero-grade variant. Big input, autocomplete dropdown,
// selected-state panel with a refresh button that re-pulls the company's
// quarterly data from its origin.
export default function CompanySearch({
  compact = false,
  placeholder = "Search any listed company — Reliance, TCS, HDFC Bank…",
  onSelect
}: {
  compact?: boolean;
  placeholder?: string;
  /**
   * Fires when the user picks a company from the autocomplete dropdown.
   * Used by the dashboard to scroll the All-reporters table to the
   * matching row. The panel below the input still renders — this
   * callback is additive, not a replacement.
   */
  onSelect?: (ticker: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Company[]>([]);
  const [selected, setSelected] = useState<Company | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [refreshLog, setRefreshLog] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = window.setTimeout(() => {
      fetch(`/api/companies?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((j) => j.ok && setResults((j.data || []).slice(0, 8)))
        .catch(() => setResults([]));
    }, 200);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [q]);

  const refresh = async () => {
    if (!selected) return;
    setRefreshing(true); setRefreshMsg(null); setRefreshLog(null);
    try {
      const r = await fetch("/api/refresh-company", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker: selected.ticker })
      }).then((r) => r.json());
      if (!r.ok) {
        setRefreshMsg(r.error || "Refresh failed");
      } else {
        setRefreshMsg(`Wrote ${r.data.rows.length} quarters in ${Math.round(r.data.elapsed_ms / 1000)}s.`);
        setRefreshLog(r.data.log_tail || null);
      }
    } catch (e: any) { setRefreshMsg(`Error: ${e.message}`); }
    finally { setRefreshing(false); }
  };

  const links = useMemo(() => {
    if (!selected) return [];
    return [
      { href: `/company/${encodeURIComponent(selected.ticker)}`, label: "View full results", internal: true }
    ];
  }, [selected]);

  return (
    <div className="relative w-full">
      {/* Search input */}
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-core-muted pointer-events-none" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12.5 12.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setSelected(null); setRefreshMsg(null); }}
          placeholder={placeholder}
          className={`w-full bg-white border border-core-line pl-11 pr-32 rounded-md focus:outline-none focus:border-core-ink focus:ring-2 focus:ring-core-pink/20 transition
            ${compact ? "py-2.5 text-sm" : "py-3.5 text-[15px]"}`}
        />
        <kbd className="hidden md:inline-flex absolute right-4 top-1/2 -translate-y-1/2 chip chip-ink text-[10px] pointer-events-none">
          Type to search
        </kbd>
      </div>

      {/* Autocomplete dropdown */}
      {results.length > 0 && !selected ? (
        <ul className="absolute z-30 top-full left-0 right-0 bg-white border border-core-line shadow-lg rounded-md mt-2 max-h-80 overflow-auto">
          {results.map((c) => (
            <li key={c.ticker}>
              <button
                onClick={() => {
                  setSelected(c); setResults([]); setQ(c.company_name);
                  onSelect?.(c.ticker);
                }}
                className="w-full text-left px-4 py-2.5 hover:bg-core-surface border-b border-core-line last:border-none"
              >
                <div className="text-[14px] font-semibold tracking-tightest">{c.company_name}</div>
                <div className="text-[11px] text-core-muted mt-0.5">
                  {c.ticker} · {c.sector ?? "—"}
                  {c.next_result_date ? ` · next ${c.next_result_date}` : ""}
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Selected company panel */}
      {selected ? (
        <div className="mt-3 p-4 border border-core-line bg-white rounded-md space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`/company/${encodeURIComponent(selected.ticker)}`}
                className="text-[15px] font-semibold tracking-tightest hover:text-core-pink truncate block"
              >
                {selected.company_name}
              </Link>
              <div className="text-[11px] text-core-muted">
                {selected.ticker} · {selected.sector ?? "—"}
                {selected.next_result_date ? ` · announces ${selected.next_result_date}` : ""}
              </div>
            </div>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="btn-ink text-xs"
            >
              {refreshing ? "Refreshing…" : "Refresh data"}
            </button>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target={l.internal ? undefined : "_blank"}
                rel={l.internal ? undefined : "noopener noreferrer"}
                className="pill border-core-line text-core-ink bg-white hover:border-core-pink hover:text-core-pink"
              >
                {l.label} {l.internal ? "→" : "↗"}
              </a>
            ))}
          </div>

          {refreshMsg ? (
            <div className="text-sm text-core-muted">
              <span className="font-medium text-core-ink">{refreshMsg}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
