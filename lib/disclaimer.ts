// Shared disclaimer copy. One place to edit — every surface pulls from
// these constants so the wording stays consistent across the footer,
// tooltips on page titles, and inline notes beside live prices.
//
// Keep each string one sentence where possible — tooltips truncate
// visually on narrow viewports and a long paragraph becomes unreadable.

/** Short-form disclaimer — fits next to page titles in a tooltip. */
export const DISCLAIMER_SHORT =
  "Earnings data from NSE, BSE and Screener.in. Live prices from Yahoo Finance, may be delayed 15-20 min during market hours. For informational use only — not investment advice.";

/** Price-specific caveat shown under the Trading Price card on
 *  company pages. Explicit about the delay window. */
export const DISCLAIMER_PRICE =
  "Price data from Yahoo Finance. May be delayed 15-20 minutes during market hours. Not real-time and not intended for trading.";

/** Markets strip tooltip — applied via the title attribute. */
export const DISCLAIMER_MARKETS =
  "Nifty 50, Sensex and Bank Nifty levels from Yahoo Finance. May be delayed 15-20 min during market hours.";
