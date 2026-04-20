"use client";

import { useEffect, useMemo, useState } from "react";

// ============================================================================
// FilingLoader — The Core's dot-dash pattern, animated.
// ----------------------------------------------------------------------------
// A signature-brand loader for the earnings tracker. Three moving parts:
//   1. A 40-unit dot-dash rail (circle + dash alternating, pink/teal/blue/ink
//      from the brand kit). A light sweeps left-to-right, lighting each unit
//      in order and then fading it. Honours prefers-reduced-motion.
//   2. A ticker label above that cycles through real large-cap symbols as
//      the sweep advances — reads like a newsroom parser stepping through
//      filings.
//   3. A counter below: "Reading 47 of 500 · Q4 FY26".
//
// Use on any page that does a meaningful fetch on mount:
//   {loading ? <FilingLoader quarter="Q4 FY26" /> : <RealContent />}
// ============================================================================

// A small bank of well-known tickers — just enough to feel varied without
// loading /api/companies on mount. These names flash during the sweep.
const TICKERS = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", "LT", "ITC",
  "HINDUNILVR", "BHARTIARTL", "KOTAKBANK", "AXISBANK", "ASIANPAINT", "MARUTI",
  "BAJFINANCE", "HCLTECH", "WIPRO", "SUNPHARMA", "TITAN", "ULTRACEMCO",
  "NESTLEIND", "POWERGRID", "NTPC", "ONGC", "ADANIENT", "COALINDIA",
  "M&M", "JSWSTEEL", "TATASTEEL", "DRREDDY", "CIPLA", "GRASIM"
];

// 40-unit pattern definition. Alternating dot/dash so the rail feels like
// morse code. Colors cycle brand palette every 6 units so the sweep makes
// a visible pink→ink→teal→ink→blue→ink ripple.
const PATTERN: Array<{ kind: "dot" | "dash"; color: string }> = (() => {
  const COLORS = ["#EC2D7A", "#0A0A0A", "#17AB8C", "#0A0A0A", "#1D52F2", "#0A0A0A"];
  return Array.from({ length: 40 }, (_, i) => ({
    kind: (i % 2 === 0 ? "dot" : "dash") as "dot" | "dash",
    color: COLORS[i % COLORS.length]
  }));
})();

const UNIT_W = 28;        // px width per pattern unit
const SWEEP_MS = 55;      // ms per unit advance
const FADE_UNITS = 6;     // trailing units that stay lit with fading opacity
const TOTAL_W = PATTERN.length * UNIT_W;

export default function FilingLoader({
  quarter = "Q4 FY26",
  total = 500,
  label = "Reading filings"
}: {
  quarter?: string;
  total?: number;
  label?: string;
}) {
  const [tick, setTick] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Drive the sweep. When reduced-motion is on, we don't animate the rail
  // but we still cycle the ticker + counter slowly so there's a pulse.
  useEffect(() => {
    const interval = reducedMotion ? 650 : SWEEP_MS;
    const id = window.setInterval(() => setTick((t) => t + 1), interval);
    return () => window.clearInterval(id);
  }, [reducedMotion]);

  const activeIndex = tick % PATTERN.length;

  // Ticker symbol flashes with the sweep — every 4 units advances it one
  // symbol, so the reader's eye doesn't get whiplash.
  const tickerSymbol = useMemo(() => {
    return TICKERS[Math.floor(tick / 4) % TICKERS.length];
  }, [tick]);

  // Counter climbs 1..total then holds at total until real content replaces
  // us. Progresses slower than the sweep so 500 isn't reached in a second.
  const counter = Math.min(total, Math.floor(tick * (total / 120)) + 1);

  return (
    <div
      className="flex flex-col items-center justify-center py-16 md:py-24 select-none"
      role="status"
      aria-live="polite"
      aria-label={`${label}, ${counter} of ${total}`}
    >
      {/* Flashing ticker */}
      <div className="h-6 mb-5 flex items-center">
        <span
          key={tickerSymbol}
          className="font-sans text-[11px] uppercase tracking-[0.18em] font-semibold text-core-ink tabular-nums animate-[fadePulse_0.22s_ease-out]"
        >
          {tickerSymbol}
        </span>
      </div>

      {/* Dot-dash rail */}
      <svg
        width={TOTAL_W}
        height="16"
        viewBox={`0 0 ${TOTAL_W} 16`}
        aria-hidden
        className="max-w-full"
      >
        {PATTERN.map((unit, i) => {
          // Distance (in units) from the sweep's leading edge, measured
          // backward. Positive = recently lit, negative = not yet lit.
          const distance = (activeIndex - i + PATTERN.length) % PATTERN.length;
          // Light only the active unit + a short trail behind it.
          const isLit = distance < FADE_UNITS;
          const opacity = isLit ? 1 - (distance / FADE_UNITS) * 0.85 : 0.12;
          const fill = isLit ? unit.color : "#D8D8D8";
          const cx = i * UNIT_W + UNIT_W / 2;

          return unit.kind === "dot" ? (
            <circle
              key={i}
              cx={cx}
              cy={8}
              r={4}
              fill={fill}
              opacity={opacity}
              style={{ transition: "opacity 120ms ease-out" }}
            />
          ) : (
            <rect
              key={i}
              x={i * UNIT_W + 4}
              y={6}
              width={UNIT_W - 8}
              height={4}
              rx={2}
              fill={fill}
              opacity={opacity}
              style={{ transition: "opacity 120ms ease-out" }}
            />
          );
        })}
      </svg>

      {/* Counter */}
      <div className="mt-5 flex items-baseline gap-2 text-core-muted">
        <span className="text-[11px] uppercase tracking-[0.14em]">{label}</span>
        <span className="text-core-line-2">·</span>
        <span className="text-sm font-semibold tabular-nums text-core-ink">
          {counter} <span className="text-core-muted font-normal">of {total}</span>
        </span>
        <span className="text-core-line-2">·</span>
        <span className="text-[11px] uppercase tracking-[0.14em]">{quarter}</span>
      </div>

      {/* One-off keyframe for the ticker flash. Defined inline so the
          component ships self-contained without a tailwind plugin. */}
      <style jsx>{`
        @keyframes fadePulse {
          0%   { opacity: 0; transform: translateY(2px); }
          50%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 0.9; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
