"""
BSE result-PDF parser.

Same-day numbers path. The Indian filing cadence is:

  Hour 0    Company files PDF on BSE (we have the URL within ~minutes via
            scripts/bse_results.py → announcement_events.raw_json.filing_url)
  Hour 2-12 Screener.in indexes the filing
  Hour 24+  BSE FinancialResult grid indexes it
  Day 1-3   NSE XBRL index indexes it

We can't wait 2-12 hours for Screener on launch day. Every BSE filing has a
PDF live the moment the announcement hits. Parse it.

SEBI mandates a standardised template for quarterly/annual result filings,
so the same canonical row labels appear in every filing — "Revenue from
operations", "Profit for the period", "Basic EPS", etc. Banks and insurers
use adjacent schemas ("Interest Earned", "Net premium earned"). Units are
declared in a single line near the top — "(₹ in crore)" / "(₹ in million)"
/ "(₹ in lakhs)".

Layout variations we handle:
  - Label-on-left  : "Revenue from operations 33,981 33,872 30,246 ..."   (HCL)
  - Label-in-mid   : "67,477.9 56,670.4 55,038.8 i Revenue from Operations ..." (Nestle)
  - Label-on-right : rare; same first-numeric-token rule holds.

Invariant across all layouts: in SEBI's mandated template, the CURRENT quarter
is always the FIRST numeric column. So for any row we find matching a
canonical label, the first numeric token on that row = our value.

Fallback chain:
  1. Prefer the Consolidated Statement of Financial Results if present
  2. Otherwise Standalone
  3. If the PDF is image-scanned (no extractable text), mark missed and let
     Screener fill in later.

Storage:
  source='bse_pdf'
  data_quality_status= 'ok' (rev+np) | 'partial' (one missing) | 'missing'
  raw_json={filing_url, section:'consolidated'|'standalone', unit_label, parser_version}

Run:
    py scripts/bse_pdf_results.py                      # process pending today's filings
    py scripts/bse_pdf_results.py --ticker HCLTECH.NS  # one company
    py scripts/bse_pdf_results.py --days 7             # last N days of events
    py scripts/bse_pdf_results.py --force              # reparse even if numbers exist
"""

from __future__ import annotations

import argparse
import io
import os
import re
import sys
import traceback
from datetime import date, datetime, timedelta
from typing import Any

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

import pdfplumber
from curl_cffi import requests as cffi_requests
from supabase import create_client


SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

PARSER_VERSION = 1

# --- Canonical label aliases --------------------------------------------------
# First match on the page wins. We deliberately list more specific phrases
# first so "Profit for the period" is picked before "Net Profit" (some
# templates print both, the first is the primary line item).

LABEL_ALIASES: dict[str, list[str]] = {
    "revenue": [
        # Manufacturing/services (most common)
        "revenue from operations",
        "total revenue from operations",
        "income from operations",
        "total income from operations",
        # Banks
        "interest earned",
        "total interest earned",
        # Insurers
        "net premium earned",
        "premium earned (net)",
        "gross premium written",
        # Broad fallback — keep LAST; many filings list "Total Income"
        # both for the P&L top line AND for "Revenue + Other income".
        # We want the top line.
        "revenue from contracts with customers",
    ],
    "net_profit": [
        "profit for the period / year",
        "profit for the period/ year",
        "profit for the period/year",
        "profit for the period",
        "profit/(loss) for the period",
        "profit / (loss) for the period",
        "net profit for the period",
        "net profit / (loss) for the period",
        "net profit/(loss) for the period",
        "profit after tax",
    ],
    "operating_profit": [
        # We store "profit before tax" here as a proxy (same as NSE XBRL path).
        "profit before tax",
        "profit/(loss) before tax",
        "profit / (loss) before tax",
        "profit before exceptional items and tax",
        "profit before exceptional item and tax",
        # Banks
        "operating profit before provisions and contingencies",
        "operating profit",
    ],
    "eps": [
        # Prefer basic EPS over diluted; prefer the primary line over
        # "annualised" / "not annualised" footnote rows.
        "basic / diluted eps",
        "basic/diluted eps",
        "basic and diluted earnings per share",
        "basic earnings per share",
        "basic eps",
        "basic (in",      # HCL-style "Basic (in ₹) 16.59 ..."
    ],
}

# --- Unit detection -----------------------------------------------------------
# The PDF declares units once near the top. Two flavours seen in the wild:
#
#   Formal:   "(₹ in crore)", "(Rs. in Lakhs)", "(t in crores)" (typo for ₹)
#   Casual:   just "lakhs" on its own line (Tata Elxsi), "Amount in Crore"
#             in a cell, "Rs. crore" at top of column.
#
# We match in two passes: precise "in <unit>" tokens first, then loose
# "standalone unit word" fallback. The loose pass also looks at the wider
# section body (first 3000 chars) because some filers put the unit inside
# the table header rather than above it.

UNIT_MULTIPLIERS: list[tuple[str, int]] = [
    # Order matters: longer strings first so "in lakhs" isn't swallowed by
    # "in lakh". We also list "lakhs" before "lakh" for the loose pass.
    ("in crores",    10_000_000),
    ("in crore",     10_000_000),
    ("in cr",        10_000_000),
    ("in lakhs",     100_000),
    ("in lakh",      100_000),
    ("in lacs",      100_000),   # Common Indian English spelling
    ("in lac",       100_000),
    ("in millions",  1_000_000),
    ("in million",   1_000_000),
    ("in mn",        1_000_000),
    ("in thousands", 1_000),
    ("in thousand",  1_000),
]

# Loose fallback: bare unit words. Applied ONLY if the precise pass fails
# AND the word appears near a "Particulars" header row (table caption).
LOOSE_UNIT_TOKENS: list[tuple[str, int]] = [
    ("crores",    10_000_000),
    ("crore",     10_000_000),
    ("lakhs",     100_000),
    ("lakh",      100_000),
    ("lacs",      100_000),
    ("millions",  1_000_000),
    ("million",   1_000_000),
]


def detect_unit(text: str) -> tuple[str, int] | None:
    """Scan for a unit declaration in the section head."""
    head = text[:3000].lower()
    # Normalise typographic clutter. Don't naively strip 'rs ' or 'rs.' —
    # those substrings appear inside "Particulars" and other real English
    # words. Keep the currency symbols in; the "in crore"/"in lakh" tokens
    # match regardless of what precedes them.
    norm = head.replace("₹", " ").replace("(", " ").replace(")", " ") \
               .replace("|", " ")

    # Pass 1: precise "in <unit>" tokens.
    for token, mult in UNIT_MULTIPLIERS:
        if token in norm:
            return token, mult

    # Pass 2: loose standalone unit word, but only if it sits near a table
    # caption. "Particulars" is the universal SEBI-template header for the
    # line-item column; any bare-word unit within ~150 chars of it is the
    # table's unit.
    parts_idx = norm.find("particulars")
    if parts_idx != -1:
        window = norm[max(0, parts_idx - 300): parts_idx + 50]
        for token, mult in LOOSE_UNIT_TOKENS:
            # Match as standalone word — avoid matching "crore" inside
            # "crorepati" or similar. Also skip if the word is immediately
            # preceded by "per " (e.g. "per crore"), which is never a unit
            # declaration.
            pat = re.compile(rf"(?<![a-z]){re.escape(token)}(?![a-z])")
            m = pat.search(window)
            if m and not window[max(0, m.start() - 5): m.start()].endswith("per "):
                return token, mult
    return None


# --- Numeric token extraction -------------------------------------------------
# Indian result PDFs use: 67,477.90 | (1,234.56) for negatives | sometimes
# dashes or "-" for zero. We also need to ignore row-numbering like
# "1" / "2" / "(i)" that precede a value in some templates.

NUM_RE = re.compile(
    r"""
    (?<!\w)               # not in middle of a word
    (\(?                   # optional opening paren for negatives
      -?                    # or leading minus
      \d{1,3}(?:,\d{2,3})*  # digits with Indian-style grouping (lakhs/crores OK too)
      (?:\.\d+)?            # optional decimal
    \)?)                   # optional closing paren
    (?!\w)
    """,
    re.VERBOSE,
)


def parse_number(tok: str) -> float | None:
    """Parse '67,477.9' or '(1,234.56)' → float. Returns None for non-numerics."""
    s = tok.strip()
    if s in ("-", "–", "—", "nil", "NIL", ""):
        return 0.0
    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg = True
        s = s[1:-1]
    s = s.replace(",", "").replace(" ", "")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def numeric_tokens(line: str) -> list[float]:
    """Extract numbers from a PDF text line, in left-to-right order."""
    out: list[float] = []
    for m in NUM_RE.finditer(line):
        v = parse_number(m.group(1))
        if v is not None:
            out.append(v)
    return out


# --- Section splitting --------------------------------------------------------
# A quarterly-result PDF typically contains, in order:
#   - Cover letter (pages 1, sometimes 2)
#   - Standalone Financial Results (1-3 pages)
#   - Balance Sheet
#   - Cash Flow
#   - Consolidated Financial Results (1-3 pages) [if applicable]
#   - Notes / Auditor's report / Segment reporting
# We split the full-text blob by section header regex, pick consolidated
# first then standalone.

SECTION_MARKERS = {
    "consolidated": re.compile(
        r"^\s*(?:statement\s+of\s+)?consolidated\s+(?:statement\s+of\s+)?"
        r"(?:audited\s+|unaudited\s+)?financial\s+results\b",
        re.IGNORECASE | re.MULTILINE,
    ),
    "standalone": re.compile(
        r"^\s*(?:statement\s+of\s+)?standalone\s+(?:statement\s+of\s+)?"
        r"(?:audited\s+|unaudited\s+)?financial\s+results\b",
        re.IGNORECASE | re.MULTILINE,
    ),
    # Fallback for filers who omit the consolidated/standalone qualifier
    # on the heading (Tata Elxsi, some mid-caps). We match "Statement of
    # [Audited/Unaudited] Financial Results" on its own line.
    "generic": re.compile(
        r"^\s*statement\s+of\s+(?:audited\s+|unaudited\s+)?financial\s+results\b",
        re.IGNORECASE | re.MULTILINE,
    ),
}

# A section "ends" where the next one begins, or after a generous cap
# (see split_sections). The row scan falls off naturally once no more
# canonical labels match, so we don't need a strict end marker.


def split_sections(full_text: str) -> dict[str, str]:
    """Return {'consolidated': ..., 'standalone': ...} — each the text from
    its header through the next section boundary."""
    found: dict[str, tuple[int, int]] = {}
    for name, pat in SECTION_MARKERS.items():
        m = pat.search(full_text)
        if m:
            found[name] = (m.start(), m.end())

    out: dict[str, str] = {}
    # Sort by start position and slice to the next boundary.
    ordered = sorted(found.items(), key=lambda kv: kv[1][0])
    for i, (name, (start, _)) in enumerate(ordered):
        end = len(full_text)
        if i + 1 < len(ordered):
            end = ordered[i + 1][1][0]
        # Also truncate at balance-sheet-like markers if they come first.
        # Allow up to 20 KB of section body — more than enough for the P&L.
        end = min(end, start + 20_000)
        out[name] = full_text[start:end]
    return out


# --- Row picker ---------------------------------------------------------------

def _is_row_number_only(toks: list[float]) -> bool:
    """True if the line's only numeric content looks like a section row
    number (e.g. "1 Income from operations" — a heading with no real data).

    Heuristic: exactly one token, is a small integer 1-20, no decimal part."""
    if len(toks) != 1:
        return False
    v = toks[0]
    return 1 <= v <= 20 and float(int(v)) == v


def find_label_line(section: str, aliases: list[str]) -> tuple[str, str] | None:
    """Search for a line matching one of the aliases and carrying real
    numeric data. Aliases are tried in SPECIFICITY ORDER — the caller lists
    the most specific phrase first ("revenue from operations" before the
    looser "income from operations"). We try each alias across ALL lines
    before falling to the next one, so a heading like "1 Income from
    operations" never shadows the data row "(a) Revenue from operations
    99,375.12 ...".
    """
    lines = section.splitlines()
    lc_lines = [l.lower() for l in lines]
    for a in (s.lower() for s in aliases):
        for line, lc in zip(lines, lc_lines):
            if a not in lc:
                continue
            toks = numeric_tokens(line)
            if not toks:
                continue
            # Skip heading-only rows ("1 Income from operations") — they'd
            # trick us into returning the row number as a financial value.
            if _is_row_number_only(toks):
                continue
            return a, line
    return None


def extract_value(section: str, aliases: list[str]) -> float | None:
    """Find the canonical row and return the current-quarter value.

    SEBI template invariant: the current quarter is always the first numeric
    column — but that column may sit to the LEFT of the label (Nestle:
    "67,477.9 56,670.4 55,038.8 i Revenue from Operations 231,546.0 ...")
    or to the RIGHT (HCL: "Revenue from operations 33,981 33,872 30,246
    130,144 117,055"), depending on the filer's template.

    Detection rule: if there are 3+ numeric tokens to the left of the label,
    this is the values-first layout → take left[0]. Otherwise take right[0]
    (the common label-first layout, plus the "(a) Revenue from operations
    99,375.12" sublabel layout where left has only a non-numeric marker).
    """
    hit = find_label_line(section, aliases)
    if not hit:
        return None
    label, line = hit
    pos = line.lower().find(label)
    left_toks = numeric_tokens(line[:pos])
    right_toks = numeric_tokens(line[pos + len(label):])

    if len(left_toks) >= 3:
        return left_toks[0]
    if right_toks:
        return right_toks[0]
    if left_toks:
        return left_toks[0]
    return None


# --- Main parse orchestration -------------------------------------------------

def parse_pdf(pdf_bytes: bytes) -> dict[str, Any]:
    """Parse a BSE filing PDF to extract Q-values + metadata.

    Returns:
      {
        'section':  'consolidated' | 'standalone' | None,
        'unit':     'in crore' (or similar),
        'mult':     10_000_000,   # multiplier to raw rupees
        'revenue':          float | None,   # raw rupees
        'net_profit':       float | None,
        'operating_profit': float | None,
        'eps':              float | None,   # per-share (no unit scale)
        'pages':    int,
        'text_chars': int,    # signal for image-scan detection
      }
    """
    result: dict[str, Any] = {
        "section": None, "unit": None, "mult": None,
        "revenue": None, "net_profit": None,
        "operating_profit": None, "eps": None,
        "pages": 0, "text_chars": 0,
    }

    try:
        pdf = pdfplumber.open(io.BytesIO(pdf_bytes))
    except Exception as e:
        result["error"] = f"pdf open: {e}"
        return result
    try:
        result["pages"] = len(pdf.pages)
        buf: list[str] = []
        # Cap at first 30 pages — quarterly result PDFs are always front-loaded
        # with financials. Later pages are notes, auditor reports, etc.
        for p in pdf.pages[:30]:
            try:
                t = p.extract_text() or ""
            except Exception:
                t = ""
            buf.append(t)
        full = "\n".join(buf)
    finally:
        pdf.close()

    result["text_chars"] = len(full)
    if len(full) < 500:
        result["error"] = "pdf appears image-scanned (no extractable text)"
        return result

    sections = split_sections(full)
    # Prefer consolidated. Fall back to standalone. Fall back to the
    # "generic" (unqualified) section header. Fall back to full text
    # (for PDFs where pdfplumber's text extraction lost the heading).
    section_text: str
    section_name: str | None
    if "consolidated" in sections:
        section_text, section_name = sections["consolidated"], "consolidated"
    elif "standalone" in sections:
        section_text, section_name = sections["standalone"], "standalone"
    elif "generic" in sections:
        section_text, section_name = sections["generic"], "unqualified"
    else:
        section_text, section_name = full, None
    result["section"] = section_name

    unit_info = detect_unit(section_text) or detect_unit(full)
    if unit_info:
        result["unit"] = unit_info[0]
        result["mult"] = unit_info[1]

    # If the unit wasn't detected, we CAN'T safely scale revenue/profit
    # numbers — 99,375 could be lakhs, crores, or raw rupees. Refuse to
    # write scaled values in that case. EPS is per-share and unit-less,
    # so we can still surface it.
    if result["mult"] is None:
        result["revenue"] = None
        result["net_profit"] = None
        result["operating_profit"] = None
        result["eps"] = extract_value(section_text, LABEL_ALIASES["eps"])
        result["error"] = "unit not detected — refusing to scale"
        return result

    def scaled(v: float | None) -> float | None:
        if v is None:
            return None
        return v * result["mult"]

    result["revenue"] = scaled(extract_value(section_text, LABEL_ALIASES["revenue"]))
    result["net_profit"] = scaled(extract_value(section_text, LABEL_ALIASES["net_profit"]))
    result["operating_profit"] = scaled(
        extract_value(section_text, LABEL_ALIASES["operating_profit"])
    )
    # EPS is per-share, not in crores — skip the multiplier.
    result["eps"] = extract_value(section_text, LABEL_ALIASES["eps"])
    return result


# --- Quarter derivation -------------------------------------------------------
# The event's announcement_date tells us WHEN it was announced, not WHICH
# quarter. We infer from the PDF heading ("Quarter ended 31st March 2026")
# or fall back to: announcement_date's PREVIOUS quarter end.

QUARTER_END_PAT = re.compile(
    r"""
    (?:quarter|period|three\s+months)\s+ended
    [^0-9]{0,30}
    (\d{1,2})
    [\s\./-]+
    (\d{1,2}|[A-Za-z]{3,9})
    [\s\./-]+
    (20\d{2})
    """,
    re.IGNORECASE | re.VERBOSE,
)

MONTH_NUM = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    "january":1, "february":2, "march":3, "april":4, "may":5, "june":6,
    "july":7, "august":8, "september":9, "october":10, "november":11,
    "december":12,
}


def detect_quarter_end(full_text: str) -> date | None:
    """Find the 'quarter ended DD-MM-YYYY' anchor in the PDF."""
    for m in QUARTER_END_PAT.finditer(full_text[:5000]):
        dd, mm_raw, yyyy = m.group(1), m.group(2), m.group(3)
        try:
            d = int(dd)
            if mm_raw.isdigit():
                mo = int(mm_raw)
            else:
                mo = MONTH_NUM.get(mm_raw.lower()[:3])
                if mo is None:
                    continue
            y = int(yyyy)
            return date(y, mo, d)
        except (ValueError, KeyError):
            continue
    return None


def normalize_period_end(d: date) -> date:
    """Snap to Indian fiscal quarter-ends."""
    m, y = d.month, d.year
    if 4 <= m <= 6:   return date(y, 6, 30)
    if 7 <= m <= 9:   return date(y, 9, 30)
    if 10 <= m <= 12: return date(y, 12, 31)
    return date(y, 3, 31)


def to_fiscal(d: date) -> tuple[int, int, str]:
    m, y = d.month, d.year
    if 4 <= m <= 6:    fq, fy = 1, y + 1
    elif 7 <= m <= 9:  fq, fy = 2, y + 1
    elif 10 <= m <= 12: fq, fy = 3, y + 1
    else:              fq, fy = 4, y
    return fy, fq, f"Q{fq} FY{str(fy)[-2:]}"


def derive_quarter_end(full_text: str, announcement_date: date) -> date:
    """Use the PDF's own anchor if present, else fall back to the quarter
    ending immediately BEFORE announcement_date (results are always filed
    AFTER quarter-end)."""
    parsed = detect_quarter_end(full_text)
    if parsed:
        return normalize_period_end(parsed)
    # Fallback: previous quarter end relative to announcement.
    m, y = announcement_date.month, announcement_date.year
    # Companies typically file results 2-6 weeks after quarter end.
    # Walk back until we hit a quarter-end in the recent past.
    candidates = [date(y, 3, 31), date(y, 6, 30), date(y, 9, 30),
                  date(y, 12, 31), date(y - 1, 12, 31)]
    past = [c for c in candidates if c <= announcement_date]
    past.sort(reverse=True)
    return past[0] if past else date(y - 1, 12, 31)


# --- DB I/O -------------------------------------------------------------------

def resolve_targets(sb, args) -> list[dict]:
    """Find events that need PDF parsing.

    Criteria:
      - announcement_date within --days of today
      - status = 'fetched' (BSE/NSE/MC confirmed the filing)
      - raw_json.filing_url is set (we have a PDF to parse)
      - NOT already have a quarterly_financials row for the relevant quarter
        (unless --force)
    """
    if args.ticker:
        events = sb.table("announcement_events") \
            .select("id,ticker,announcement_date,raw_json,companies!inner(id,company_name,is_active)") \
            .eq("ticker", args.ticker.upper()) \
            .eq("companies.is_active", True) \
            .order("announcement_date", desc=True) \
            .limit(5) \
            .execute().data or []
    else:
        cutoff = (date.today() - timedelta(days=args.days)).isoformat()
        events = sb.table("announcement_events") \
            .select("id,ticker,announcement_date,raw_json,companies!inner(id,company_name,is_active)") \
            .eq("status", "fetched") \
            .gte("announcement_date", cutoff) \
            .lte("announcement_date", date.today().isoformat()) \
            .eq("companies.is_active", True) \
            .order("announcement_date", desc=True) \
            .execute().data or []

    # Keep only events with a filing_url; collapse duplicates per ticker
    # (sometimes calendars + filing poller create 2 rows for the same day).
    seen: set[str] = set()
    keep: list[dict] = []
    for e in events:
        ticker = e["ticker"]
        raw = e.get("raw_json") or {}
        if not isinstance(raw, dict):
            continue
        url = raw.get("filing_url")
        if not url or not url.lower().endswith(".pdf"):
            continue
        key = f"{ticker}|{e['announcement_date']}"
        if key in seen:
            continue
        seen.add(key)
        keep.append(e)

    if args.force:
        return keep

    # Filter out tickers that already have numbers for the derived quarter.
    # We don't know the exact quarter until we fetch the PDF, so use a
    # cheaper heuristic: if the company has ANY quarterly_financials row
    # newer than 60 days before announcement_date, we've likely got the
    # relevant quarter. Users can pass --force to ignore this.
    pruned: list[dict] = []
    for e in keep:
        ad = datetime.strptime(e["announcement_date"], "%Y-%m-%d").date()
        floor = (ad - timedelta(days=60)).isoformat()
        existing = sb.table("quarterly_financials") \
            .select("quarter_end_date,source") \
            .eq("ticker", e["ticker"]) \
            .gte("quarter_end_date", floor) \
            .limit(1).execute().data or []
        if existing:
            continue
        pruned.append(e)
    return pruned


def upsert_row(sb, company: dict, ticker: str, ann_date: date, parsed: dict,
               filing_url: str, quarter_end: date) -> dict:
    """Write to quarterly_financials. Returns {'written': bool, 'reason': str}."""
    fy, fq, label = to_fiscal(quarter_end)

    missing = sum(v is None for v in (parsed.get("revenue"), parsed.get("net_profit")))
    quality = "ok" if missing == 0 else ("partial" if missing == 1 else "missing")

    if parsed.get("revenue") is None and parsed.get("net_profit") is None:
        return {"written": False, "reason": "no rev/np extracted"}

    # Don't clobber a better source. If Screener or NSE has already written
    # THIS quarter, respect it — their reconciliation is more reliable than
    # our template-matching.
    existing = sb.table("quarterly_financials").select("source,data_quality_status") \
        .eq("ticker", ticker).eq("quarter_end_date", quarter_end.isoformat()) \
        .limit(1).execute().data or []
    if existing and existing[0].get("source") in ("screener", "nse"):
        if existing[0].get("data_quality_status") == "ok":
            return {"written": False, "reason": f"already have {existing[0]['source']} row"}

    row = {
        "company_id": company["id"],
        "ticker": ticker,
        "quarter_label": label,
        "quarter_end_date": quarter_end.isoformat(),
        "fiscal_year": fy,
        "fiscal_quarter": fq,
        "revenue":          parsed.get("revenue"),
        "net_profit":       parsed.get("net_profit"),
        "operating_profit": parsed.get("operating_profit"),
        "eps":              parsed.get("eps"),
        "currency": "INR",
        "source": "bse_pdf",
        "raw_json": {
            "filing_url":     filing_url,
            "section":        parsed.get("section"),
            "unit_label":     parsed.get("unit"),
            "unit_mult":      parsed.get("mult"),
            "pages":          parsed.get("pages"),
            "text_chars":     parsed.get("text_chars"),
            "parser_version": PARSER_VERSION,
        },
        "data_quality_status": quality,
        "fetched_at": datetime.utcnow().isoformat() + "Z",
    }
    sb.table("quarterly_financials").upsert(
        row, on_conflict="ticker,quarter_end_date"
    ).execute()
    return {"written": True, "reason": f"{quality} ({label})"}


def log_fetch(sb, ticker: str, status: str, message: str) -> None:
    try:
        sb.table("fetch_logs").insert({
            "ticker": ticker,
            "source": "bse_pdf",
            "fetch_status": status,
            "message": (message or "")[:2000],
        }).execute()
    except Exception as e:
        print(f"[warn] fetch_logs insert failed: {e}", file=sys.stderr)


# --- PDF download -------------------------------------------------------------

_session = None


def bse_session():
    global _session
    if _session is not None:
        return _session
    s = cffi_requests.Session(impersonate="chrome")
    s.headers.update({
        "Accept": "application/pdf,*/*",
        "Referer": "https://www.bseindia.com/",
        "Accept-Language": "en-US,en;q=0.9",
    })
    # Prime cookies.
    s.get("https://www.bseindia.com/", timeout=25)
    _session = s
    return s


def download_pdf(url: str, timeout: int = 60) -> bytes:
    s = bse_session()
    r = s.get(url, timeout=timeout)
    r.raise_for_status()
    return r.content


# --- CLI ----------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", help="single ticker (e.g. HCLTECH.NS)")
    ap.add_argument("--days", type=int, default=3,
                    help="how many days back of events to consider (default 3)")
    ap.add_argument("--force", action="store_true",
                    help="reparse even when a quarterly_financials row already exists")
    ap.add_argument("--limit", type=int, default=0,
                    help="process at most N events (0 = no cap)")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
              file=sys.stderr)
        return 2
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    events = resolve_targets(sb, args)
    if args.limit > 0:
        events = events[: args.limit]

    if not events:
        print("No events to process. All recent filings already have numbers.")
        return 0

    print(f"Processing {len(events)} BSE filing PDFs...")
    ok = partial = miss = err = 0
    for i, e in enumerate(events, 1):
        ticker = e["ticker"]
        raw = e.get("raw_json") or {}
        url = raw.get("filing_url")
        ann_date = datetime.strptime(e["announcement_date"], "%Y-%m-%d").date()
        company = {"id": e["companies"]["id"], "company_name": e["companies"]["company_name"]}

        try:
            pdf_bytes = download_pdf(url)
        except Exception as exc:
            err += 1
            log_fetch(sb, ticker, "failed", f"download: {exc}")
            print(f"[{i:3d}/{len(events)}] {ticker:<16} download ERR: {exc}", file=sys.stderr)
            continue

        parsed = parse_pdf(pdf_bytes)
        if parsed.get("error"):
            err += 1
            log_fetch(sb, ticker, "failed", parsed["error"])
            print(f"[{i:3d}/{len(events)}] {ticker:<16} parse ERR: {parsed['error']}")
            continue

        # Get the full text once more for quarter-end detection (cheap; pdfplumber
        # caches inside parse_pdf but we discarded the text). Re-open for safety.
        try:
            pdf = pdfplumber.open(io.BytesIO(pdf_bytes))
            full_text = "\n".join((p.extract_text() or "") for p in pdf.pages[:5])
            pdf.close()
        except Exception:
            full_text = ""
        quarter_end = derive_quarter_end(full_text, ann_date)

        res = upsert_row(sb, company, ticker, ann_date, parsed, url, quarter_end)
        quality = "ok" if (parsed.get("revenue") and parsed.get("net_profit")) else \
                  ("partial" if (parsed.get("revenue") or parsed.get("net_profit")) else "missing")

        def cr(v):
            if v is None:
                return "-"
            return f"{v/10_000_000:.0f}Cr"

        summary = (
            f"{parsed.get('section') or '?':<12} unit={parsed.get('unit') or '?':<10} "
            f"rev={cr(parsed.get('revenue'))} np={cr(parsed.get('net_profit'))} "
            f"eps={parsed.get('eps')}"
        )
        if res["written"]:
            if quality == "ok":
                ok += 1
                log_fetch(sb, ticker, "success", f"ok {summary}")
                print(f"[{i:3d}/{len(events)}] {ticker:<16} OK  {summary}")
            else:
                partial += 1
                log_fetch(sb, ticker, "success", f"partial {summary}")
                print(f"[{i:3d}/{len(events)}] {ticker:<16} PARTIAL {summary}")
        else:
            miss += 1
            log_fetch(sb, ticker, "failed", f"{res['reason']}; {summary}")
            print(f"[{i:3d}/{len(events)}] {ticker:<16} skip {res['reason']}: {summary}")

    print(f"\nDone. {ok} ok, {partial} partial, {miss} skipped, {err} errors.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
