"use client";

// InfoTooltip — small "ⓘ" icon with a hover tooltip. Primary use is for
// compact disclaimers next to page titles, live-price cards, and the
// Markets strip — places where we want the reader to KNOW a caveat
// exists without cluttering the visible copy.
//
// Design choices:
//   - Native <button> (not <span>) so it's keyboard-focusable and a
//     screen reader announces it as an interactive element
//   - Tooltip positioned below-right by default, with a max-width so
//     long disclaimers wrap cleanly
//   - Shows on :hover and :focus (keyboard users matter too)
//   - Uses CSS-only reveal (no JS state) — simpler, faster, no flicker
//
// Usage:
//   <InfoTooltip
//     text="Price data from Yahoo Finance, may be delayed 15-20 min during market hours."
//   />
//   <h1>Title <InfoTooltip text="..." /></h1>

import React from "react";

export default function InfoTooltip({
  text,
  className = "",
  ariaLabel = "More information",
  position = "below",
}: {
  /** Disclaimer / explanation copy shown on hover. */
  text: string;
  className?: string;
  ariaLabel?: string;
  /** Where the tooltip flyout appears. Default "below" — safer on short
   * pages; use "above" when the element sits near the page bottom. */
  position?: "below" | "above";
}) {
  const flyoutPos = position === "above"
    ? "bottom-full mb-2"
    : "top-full mt-2";
  return (
    <span className={`relative inline-flex group align-middle ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        // Peer-focus styling so keyboard users get the same reveal.
        className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-full border border-core-line-2 text-core-muted text-[10px] leading-none font-semibold hover:border-core-ink hover:text-core-ink focus:outline-none focus:border-core-pink focus:text-core-pink transition-colors"
      >
        i
      </button>
      {/* Tooltip flyout — hidden by default, shown on :hover and :focus-within
          of the wrapper span. Max width keeps long disclaimers readable;
          z-30 so it sits above table rows and sticky headers. */}
      <span
        role="tooltip"
        className={`absolute left-1/2 -translate-x-1/2 ${flyoutPos} w-max max-w-[320px] md:max-w-[360px] px-3 py-2 text-[11px] leading-snug text-white bg-core-ink rounded-md shadow-lg opacity-0 invisible pointer-events-none group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-opacity duration-150 z-30`}
      >
        {text}
      </span>
    </span>
  );
}
