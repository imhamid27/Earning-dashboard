"use client";

// InfoTooltip — small info icon with a hover/focus tooltip. Drops in next
// to page titles, live-price cards, and the Markets strip so readers can
// see the caveat without it cluttering the visible copy.
//
// Design:
//   - Icon: a clean stroked circle with a lowercase "i" (Heroicons-style).
//     Scales cleanly, crisp at 16/18/20 px, never rendered as weird
//     Unicode glyphs across browsers.
//   - Tooltip body: 13px, generous line-height, wider max-width — plain
//     English copy should be effortless to read, not squeezed into a
//     cramped chip. Dark background for strong contrast against the
//     page's white content; small arrow points at the trigger.
//   - Shows on :hover and :focus-within so keyboard users get it too.
//
// Usage:
//   <InfoTooltip text="Earnings data sourced from NSE and BSE filings…" />
//   <h1>Title <InfoTooltip text="…" size="md" /></h1>

import React from "react";

export default function InfoTooltip({
  text,
  className = "",
  ariaLabel = "More information",
  position = "below",
  size = "sm",
}: {
  /** Disclaimer / explanation copy shown on hover. */
  text: string;
  className?: string;
  ariaLabel?: string;
  /** Where the tooltip flyout appears. Default "below"; use "above" when
   *  the trigger sits near the page bottom. */
  position?: "below" | "above";
  /** Icon size. Default "sm" (16px). Use "md" (18px) next to larger page
   *  titles where a 16px ⓘ looks lost. */
  size?: "sm" | "md";
}) {
  const flyoutPos = position === "above" ? "bottom-full mb-2" : "top-full mt-2";
  const iconSize = size === "md" ? "w-[18px] h-[18px]" : "w-4 h-4";
  return (
    <span className={`relative inline-flex group align-middle ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        className={`inline-flex items-center justify-center ${iconSize} rounded-full text-core-muted hover:text-core-ink focus:outline-none focus:text-core-pink transition-colors`}
      >
        <InfoIcon />
      </button>

      {/* Tooltip body — dark chip with generous padding. Wider max-width
          than a typical tooltip (360px) so a two-line disclaimer reads
          comfortably without awkward mid-word wraps. */}
      <span
        role="tooltip"
        className={`absolute left-1/2 -translate-x-1/2 ${flyoutPos} w-[min(360px,calc(100vw-2rem))] px-3.5 py-2.5 text-[13px] leading-[1.5] font-normal text-white bg-core-ink rounded-md shadow-xl opacity-0 invisible pointer-events-none group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-opacity duration-150 z-30`}
      >
        {text}
      </span>
    </span>
  );
}

// Heroicons-style information circle. Stroke-based so it stays crisp
// at any size; inherits color from the parent via currentColor.
function InfoIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-full h-full"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.75" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
