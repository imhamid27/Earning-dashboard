// Shorten a board-meeting "purpose" into a compact, editorial label.
//   "To consider and approve the financial results for the period ended
//    March 31, 2026 and dividend"
//        ──────────►  "Q4 FY26 Results + Dividend"
//
// Original strings come from exchange calendars and are written in the
// verbose compliance tone used on NSE/BSE notices — too long for a table
// cell, too dull for a dashboard. This helper extracts the meaningful
// parts so the reader gets the story in a glance.

export function simplifyPurpose(raw: string | null | undefined, announceDate?: string | null): string {
  if (!raw) return "Financial Results";
  const t = raw.toLowerCase();

  // Guess the reporting quarter from the announcement date (not the
  // quarter-end mentioned inside the prose — the prose sometimes trails
  // by a filing).
  let qLabel = "";
  if (announceDate) {
    const d = new Date(announceDate + "T00:00:00");
    if (!Number.isNaN(d.getTime())) {
      const m = d.getUTCMonth() + 1;
      const y = d.getUTCFullYear();
      // Indian companies file Q4 (Jan-Mar) in April-July, Q1 (Apr-Jun) in
      // July-Oct, etc. Map announcement month → reporting quarter.
      let fq = 4, fy = y;
      if (m >= 4 && m <= 7)        { fq = 4; fy = y;     }   // Q4 of prior FY
      else if (m >= 7 && m <= 10)  { fq = 1; fy = y + 1; }   // Q1 of this FY
      else if (m >= 10 && m <= 12) { fq = 2; fy = y + 1; }   // Q2
      else                           { fq = 3; fy = y;     } // Jan-Mar → Q3
      qLabel = `Q${fq} FY${String(fy).slice(-2)} `;
    }
  }

  // Pattern match on the prose to pick a terse headline.
  if (t.includes("dividend") && t.includes("result"))  return `${qLabel}Results & Dividend`.trim();
  if (t.includes("audited")  && t.includes("result"))  return `${qLabel}Audited Results`.trim();
  if (t.includes("standalone") && t.includes("consolid")) return `${qLabel}Results (Standalone + Consolidated)`.trim();
  if (t.includes("financial result") || t.includes("financialresult")) return `${qLabel}Results`.trim();
  if (/q[1-4]\s*fy?\s*\d/.test(t))                     return raw.replace(/\s+/g, " ").trim();
  if (t.includes("board meeting"))                     return `${qLabel}Board Meeting`.trim() || "Board Meeting";

  // Fallback — take first clause up to the first comma / "for" / "of" so
  // we don't ship a 200-character noun phrase.
  const short = raw.replace(/\s+/g, " ").trim();
  const clauseEnd = short.search(/\s+(?:for|of|on|ended|regarding)\s+/i);
  const clip = clauseEnd > 0 ? short.slice(0, clauseEnd) : short;
  return clip.length > 60 ? clip.slice(0, 57) + "…" : clip;
}
