// Shared disclaimer copy. One place to edit — every surface pulls from
// these constants so the wording stays consistent across the footer,
// tooltips on page titles, and inline notes beside live prices.
//
// We deliberately avoid naming third-party publishing / aggregator
// websites in user-facing copy — the regulatory source (NSE / BSE /
// SEBI) is the only attribution we need. Backend docstrings inside
// the scraper scripts still credit the data pipelines in full.

/** Short-form disclaimer — fits next to page titles in a tooltip. */
export const DISCLAIMER_SHORT =
  "Earnings data sourced from company filings with NSE and BSE. Market prices may be delayed 15-20 minutes during trading hours. For informational use only — not investment advice.";

/** Price-specific caveat shown under the Trading Price card on
 *  company pages. Explicit about the delay window. */
export const DISCLAIMER_PRICE =
  "Market prices may be delayed 15-20 minutes during trading hours. Not real-time and not intended for trading.";

/** Markets strip tooltip — applied via the title attribute. */
export const DISCLAIMER_MARKETS =
  "Index values may be delayed 15-20 minutes during trading hours.";
