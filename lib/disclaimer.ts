// Shared disclaimer copy. One place to edit — every surface pulls from
// these constants so the wording stays consistent across the footer,
// tooltips on page titles, and inline notes beside live prices.
//
// Data attribution: NSE, BSE and Yahoo Finance are OK to name in
// user-facing copy (exchanges and a neutral market-data provider).
// We do NOT credit third-party aggregator / publishing sites here.

/** Short-form disclaimer — fits next to page titles in a tooltip. */
export const DISCLAIMER_SHORT =
  "Earnings data sourced from company filings with NSE and BSE. Live prices from Yahoo Finance, typically delayed 15-20 minutes during trading hours. For informational use only — not investment advice.";

/** Price-specific caveat shown under the Trading Price card on
 *  company pages. Explicit about the delay window. */
export const DISCLAIMER_PRICE =
  "Price data from Yahoo Finance. May be delayed 15-20 minutes during trading hours. Not real-time and not intended for trading.";

/** Markets strip tooltip — applied to the small 'i' icon on the label. */
export const DISCLAIMER_MARKETS =
  "Index values from Yahoo Finance. May be delayed 15-20 minutes during trading hours.";
