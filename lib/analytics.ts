// Thin wrapper over gtag() for sending custom events to GA4.
//
// Design goals:
//   - Zero behaviour when GA hasn't loaded (ad blockers, CSP refusals,
//     SSR). All functions are no-ops then, never throw.
//   - Typed convenience functions for the specific interactions we care
//     about, so usage sites don't have to remember event schemas.
//   - GA4 native event names (file_download, search, select_content,
//     view_item) where possible — they populate the "Engagement" reports
//     automatically without needing custom dimensions.
//
// What we track and why:
//   1. PDF filing clicks → which companies readers verify against the
//      original filing — a strong signal of editorial interest.
//   2. Ticker search → what readers want to see, including companies
//      that don't exist in our universe yet (demand discovery).
//   3. LIVE band tab switches → whether readers care about
//      today / yesterday / this-week / bellwethers.
//   4. Company detail page views (with ticker + sector) → top-viewed
//      companies report, richer than raw page_view.
//
// What we DON'T track:
//   - Mouse movement, scroll depth, reading time (noisy, low signal)
//   - Anything identifying an individual reader
//   - Any form data (no forms on this site accept PII)

type GtagFn = (command: "event" | "config" | "js", target: string, params?: Record<string, any>) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
    dataLayer?: unknown[];
  }
}

function gtag(...args: Parameters<GtagFn>) {
  if (typeof window === "undefined") return;
  if (typeof window.gtag !== "function") return;   // GA failed to load — silently no-op
  try {
    window.gtag(...args);
  } catch {
    // Never let an analytics failure interrupt the user's click path.
  }
}

// ---------------------------------------------------------------------
// Typed event helpers. Call these from components — they handle the
// GA4 event name + param shape so there's one source of truth.
// ---------------------------------------------------------------------

/** Reader clicked a PDF filing link (homepage, Q4, company detail, etc.). */
export function trackPdfClick(params: {
  ticker: string;
  company_name?: string;
  /** Which surface the click originated from. Helps us see if the
   *  homepage table or the company page drives more engagement. */
  source:
    | "homepage_table"
    | "homepage_live_band"
    | "q4_page"
    | "company_detail"
    | "company_quarters_table";
  url: string;
}) {
  gtag("event", "file_download", {
    file_extension: "pdf",
    file_name: params.company_name ? `${params.company_name} filing` : params.ticker,
    link_url: params.url,
    ticker: params.ticker,
    source: params.source,
  });
}

/** Reader picked a company from the search dropdown. */
export function trackCompanySearch(params: {
  search_term: string;
  /** The ticker they ultimately selected, if any. */
  selected_ticker?: string | null;
}) {
  gtag("event", "search", {
    search_term: params.search_term,
    matched_ticker: params.selected_ticker ?? null,
  });
}

/** Reader switched tabs on the LIVE band (Today / Yesterday / Tomorrow / etc.). */
export function trackLiveBandTab(tab: string) {
  gtag("event", "select_content", {
    content_type: "live_band_tab",
    item_id: tab,
  });
}

/** Reader landed on a company detail page. Complements the automatic
 *  page_view with structured ticker + sector so GA4 can rank them. */
export function trackCompanyView(params: {
  ticker: string;
  company_name: string;
  sector?: string | null;
}) {
  gtag("event", "view_item", {
    items: [
      {
        item_id: params.ticker,
        item_name: params.company_name,
        item_category: params.sector ?? "Unknown",
      },
    ],
  });
}
