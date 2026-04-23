"use client";

// PdfLink — a compact, uniform affordance we drop wherever a company row
// has an official filing URL. Design goals:
//   - Readable tiny: works at 10-11px font sizes inside dense tables
//   - One visual pattern across homepage, Q4 page, sector page, company
//     detail page — readers should learn the icon once and recognise it
//     anywhere
//   - Never mistaken for a broken link: we fall back to text "—" when the
//     URL is missing so the UI spacing stays consistent
//
// The icon is a minimal PDF glyph (document corner fold + "PDF" text). We
// keep it inline SVG so no sprite sheet / asset pipeline is required.

import React from "react";
import { trackPdfClick } from "@/lib/analytics";

export default function PdfLink({
  url,
  label = "PDF",
  compact = false,
  className = "",
  ticker,
  companyName,
  source = "homepage_table",
}: {
  url: string | null | undefined;
  /** Text next to the icon. Default "PDF"; pass "View filing" for verbose. */
  label?: string;
  /** When true, render icon-only (no text). Useful inside narrow columns. */
  compact?: boolean;
  className?: string;
  /** Optional analytics context — the ticker/company this PDF belongs to,
   *  and which page/surface the click came from. Used to populate the GA4
   *  file_download event. Silent no-op if omitted (for uses where we
   *  don't yet know the context). */
  ticker?: string;
  companyName?: string;
  source?:
    | "homepage_table"
    | "homepage_live_band"
    | "q4_page"
    | "company_detail"
    | "company_quarters_table";
}) {
  if (!url) {
    // Muted dash keeps the column width stable across rows.
    return (
      <span
        className={`text-core-line-2 text-[11px] ${className}`}
        aria-hidden
      >
        —
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={compact ? "View filing (PDF)" : undefined}
      className={`inline-flex items-center gap-1 text-[11px] font-medium text-core-pink hover:text-core-ink hover:underline underline-offset-2 ${className}`}
      // Stop the click bubbling up to the row-level Link that navigates to
      // the company page — we want the PDF to open in a new tab instead.
      // Also fire an analytics event so we can see which companies readers
      // verify against the source filing.
      onClick={(e) => {
        e.stopPropagation();
        if (ticker) {
          trackPdfClick({ ticker, company_name: companyName, source, url });
        }
      }}
    >
      <PdfIcon />
      {!compact && <span>{label}</span>}
    </a>
  );
}

function PdfIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="shrink-0"
    >
      {/* Document body + folded corner */}
      <path
        d="M3 1h6l3 3v9a0.5 0.5 0 0 1-0.5 0.5h-8.5a0.5 0.5 0 0 1-0.5-0.5v-11.5a0.5 0.5 0 0 1 0.5-0.5z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M9 1v3h3" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" fill="none" />
      {/* "PDF" wordmark — three short horizontal strokes */}
      <rect x="3.5" y="7" width="7" height="1" fill="currentColor" rx="0.5" />
      <rect x="3.5" y="9" width="5" height="1" fill="currentColor" rx="0.5" />
      <rect x="3.5" y="11" width="6" height="1" fill="currentColor" rx="0.5" />
    </svg>
  );
}
