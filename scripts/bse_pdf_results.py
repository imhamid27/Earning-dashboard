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
from datetime import date, datetime, timedelta, timezone
from typing import Any

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

import pdfplumber
from curl_cffi import requests as cffi_requests
from supabase import create_client

# OCR deps are optional — the parser works without them on text-based PDFs.
# We fall back to OCR only for scanned/image filings.
try:
    import fitz  # pymupdf, used for rasterising pages to images
    import pytesseract
    from PIL import Image
    _OCR_AVAILABLE = True
except ImportError:
    _OCR_AVAILABLE = False

_IST = timezone(timedelta(hours=5, minutes=30))

def _today_ist() -> str:
    return datetime.now(_IST).date().isoformat()

def _days_ago_ist(days: int) -> str:
    return (datetime.now(_IST) - timedelta(days=days)).date().isoformat()


def _try_ocr_fallback(pdf_bytes: bytes) -> str:
    """Rasterise each page and run Tesseract OCR. Used only when pdfplumber
    finds no financial-anchor text (scanned filings like Navkar Corp, ICICI
    AMC, Aqylon). Returns concatenated OCR text for the first 20 pages, or
    empty string if OCR isn't available / failed.

    Why 20 pages: SEBI filings always front-load the financial table in the
    first few pages. Going further is expensive (~2-5s per page) and only
    gathers cover-letter prose / auditor's report which we don't need.
    """
    if not _OCR_AVAILABLE:
        return ""
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return ""
    out: list[str] = []
    try:
        # Render each page at 2x scale (144 DPI equivalent) — good balance
        # between OCR accuracy and throughput. Higher zoom helps with
        # fine digits but slows the pipeline materially.
        matrix = fitz.Matrix(2.0, 2.0)
        for i in range(min(20, len(doc))):
            try:
                page = doc[i]
                # Skip pages that already have ample embedded text — they
                # don't need OCR.
                existing = page.get_text() or ""
                if len(existing) > 500 and any(
                    anchor in existing.lower() for anchor in (
                        "revenue from operations", "interest earned",
                        "net premium earned"
                    )
                ):
                    continue
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                # PSM 6 treats the page as a single uniform block of text —
                # works well for financial tables where rows are regular.
                text = pytesseract.image_to_string(img, config="--psm 6")
                if text:
                    out.append(text)
            except Exception:
                # OCR errors per-page are non-fatal — we just skip that page.
                continue
    finally:
        doc.close()
    return "\n".join(out)


SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

PARSER_VERSION = 1

# --- Canonical label aliases --------------------------------------------------
# First match on the page wins. We deliberately list more specific phrases
# first so "Profit for the period" is picked before "Net Profit" (some
# templates print both, the first is the primary line item).

LABEL_ALIASES: dict[str, list[str]] = {
    "revenue": [
        # Manufacturing/services (most common). These are tried first because
        # they are the most specific and appear at the top of the P&L table.
        "revenue from operations",
        "total revenue from operations",
        "revenue from contracts with customers",
        # Banks / NBFCs — "Interest Earned" is the top-line revenue for
        # banks (SEBI banking template). Listed before "income from
        # operations" so that bank filings are never misrouted to a
        # generic income subtotal that may carry a different amount.
        "interest earned",
        "total interest earned",
        "net interest income",
        # Insurers
        "net premium earned",
        "premium earned (net)",
        "gross premium earned",
        "gross premium written",
        # Generic — lower priority because many filings have both
        # "Revenue from Operations" AND "Income from Operations" as
        # synonyms, but some use the generic label exclusively.
        "income from operations",
        "total income from operations",
    ],
    "net_profit": [
        # Priority 1: attribution sub-line for consolidated filings.
        # "Profit attributable to: / Owners of the Company 10,839.18 ..."
        # This is what EPS is calculated on and what news agencies report.
        # Context-guarded: only matched when previous line says "profit
        # attributable", so it won't confuse balance-sheet equity lines.
        "owners of the company",
        # Priority 2: explicit loss-or-profit label — highest specificity
        # among the standard SEBI template rows. Tried BEFORE the plain
        # "profit for the period" variants so that consolidated P&L main rows
        # (format: "Profit/(Loss) for the Period/ Year") are picked up before
        # any subsidiary-breakdown notes inside the same section (which use
        # the plainer "Profit for the Period/Year" label without "/(loss)").
        "profit/(loss) for the period",
        "profit / (loss) for the period",
        # Priority 3: standard plain labels (no loss qualifier)
        "profit for the period / year",
        "profit for the period/ year",
        "profit for the period",
        "net profit for the period",
        "net profit / (loss) for the period",
        "net profit/(loss) for the period",
        # Priority 4: looser match — "profit for the period/year" (no space
        # before "year") is the format used in subsidiary notes breakdowns
        # inside consolidated filings. It is kept as a fallback for standalone
        # filings where the main P&L uses this exact phrasing.
        "profit for the period/year",
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
    ("in crones",    10_000_000),   # Common typo seen in TATAINVEST etc.
    ("in crs",       10_000_000),
    ("in cr.",       10_000_000),
    ("in cr ",       10_000_000),
    ("in lakhs",     100_000),
    ("in lakh",      100_000),
    ("in lacs",      100_000),      # Common Indian English spelling
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
    ("crs.",      10_000_000),
    ("lakhs",     100_000),
    ("lakh",      100_000),
    ("lacs",      100_000),
    ("millions",  1_000_000),
    ("million",   1_000_000),
]


def detect_unit(text: str) -> tuple[str, int] | None:
    """Scan for a unit declaration in the section.

    Strategy (in order):
      1. First anchor on the data line (first "Revenue from operations" /
         "Interest earned" / "Net premium earned" row). The table caption
         sits within ~100 lines of it — look there first. This is how we
         pick "in lakhs" over "in crore" on filings like MAHABANK where
         BOTH units appear in different places (table caption vs notes).
      2. Fallback: scan the full section for the first precise unit token.
      3. Loose bare-word pass near "Particulars" for filings that omit
         the "in " prefix (Tata Elxsi).
    """
    lc = text.lower()
    # Normalise only the glyphs/punctuation — NEVER strip 'rs ' or 'rs.'
    # because those substrings appear inside "particulars" and other
    # real English words.
    norm = lc.replace("₹", " ").replace("(", " ").replace(")", " ") \
             .replace("|", " ").replace("[", " ").replace("]", " ")

    # ---- Pass 1: unit-nearest-data. ----
    # Find the index of the first likely data-line anchor.
    anchor_phrases = (
        "revenue from operations",
        "total revenue from operations",
        "interest earned",
        "net premium earned",
        "income from operations",
    )
    anchor_idx = -1
    for p in anchor_phrases:
        i = norm.find(p)
        if i != -1 and (anchor_idx == -1 or i < anchor_idx):
            anchor_idx = i
    if anchor_idx != -1:
        # Look 5000 chars before and 5000 after the anchor. Units are
        # usually declared in the table caption (right above) but some
        # filers put them in a sub-header below (MAHABANK has "In lakhs"
        # ~60 lines / ~3500 chars AFTER the "Interest earned" row) or
        # within the first data row.
        window = norm[max(0, anchor_idx - 5000): anchor_idx + 5000]
        best: tuple[int, str, int] | None = None   # (distance, token, mult)
        for token, mult in UNIT_MULTIPLIERS:
            pos = window.find(token)
            if pos == -1:
                continue
            # Distance from the anchor in the window-relative coordinates.
            anchor_in_win = min(anchor_idx, 5000)
            d = abs(pos - anchor_in_win)
            if best is None or d < best[0]:
                best = (d, token, mult)
        if best:
            return best[1], best[2]

    # ---- Pass 2: first precise unit token anywhere in the section. ----
    for token, mult in UNIT_MULTIPLIERS:
        if token in norm:
            return token, mult

    # ---- Pass 3: loose bare-word token near "Particulars". ----
    parts_idx = norm.find("particulars")
    if parts_idx != -1:
        window = norm[max(0, parts_idx - 400): parts_idx + 100]
        for token, mult in LOOSE_UNIT_TOKENS:
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
    (?<!\w)                # not in middle of a word
    (\(?                    # optional opening paren for negatives
      -?                     # or leading minus
      (?:                    # number body — two allowed shapes:
        \d{1,3}(?:,\d{2,3})+ # (a) Indian-grouped: 7,75,515 or 12,34,56,789
        |
        \d{1,}               # (b) ungrouped: 775515 — common in bank filings
                             #     where columns are tabbed, no separator needed
      )
      (?:\.\d+)?             # optional decimal tail (paise / fractional paise)
    \)?)                    # optional closing paren
    (?!\w)
    """,
    re.VERBOSE,
)


# Some PDFs render the thousand separator as a space instead of a comma
# — "5,292.60" comes out as "5 292.60". This mangles our token extractor,
# which sees "5" then "292.60" as separate numbers.
#
# CRITICAL: the second chunk MUST have a decimal. Without that constraint
# the regex wrongly joins adjacent independent columns of a data row —
# e.g. Maharashtra Scooters has "Total revenue from operations 603 644 665
# 31276 18333" where "603", "644" and "665" are FIVE different columns
# (Q4, Q3, YoY Q, FY, prev FY), not one number "603,644,665". The decimal
# requirement tells us we're really looking at a comma-replaced-by-space
# pattern (Indian number formatting) vs. column-separated integers.
BROKEN_SEP_RE = re.compile(r"(?<!\d)(\d{1,3})\s+(\d{3}\.\d+)(?!\d)")

# OCR substitutions — scan-to-PDF sometimes replaces digits with visually
# similar letters.  We only heal inside tokens that look like Indian numbers
# (digit run, optional comma, etc.) so real words are untouched.
# Patterns:  lo,go7.7g → 10,907.79   |   7,L65.98 → 7,165.98
#            9,740.L5  → 9,740.15    |   L7.0'.l,6.56 → ignored (too garbled)
_OCR_HEAL_RE = re.compile(
    r"""
    (?<!\w)          # not preceded by a word character
    (                # capture the token to heal
      [0-9loIgS\']+  # digits OR common OCR-misread letters
      (?:[,\.][0-9loIgS\']+)*  # optional decimal / thousand parts
    )
    (?!\w)           # not followed by a word character
    """,
    re.VERBOSE,
)
_OCR_DIGIT_MAP = str.maketrans("loIgS'", "101950")


def _heal_ocr_digits(line: str) -> str:
    """Fix common OCR letter-for-digit substitutions in numeric tokens.

    Applied only to tokens that are plausibly numbers (mixed digits+letters).
    Pure alpha tokens (e.g. 'Income') are left untouched because the regex
    requires at least one real digit in the token.

    Examples:
        'lo,go7.7g'  → '10,907.79'  (l=1, o=0, g=9)
        '7,L65.98'   → '7,165.98'   (L=1 / I=1)
        '9,740.L5'   → '9,740.15'
    """
    def _fix_tok(m: re.Match) -> str:
        tok = m.group(1)
        # Only heal tokens that contain at least one digit AND at least one
        # OCR-suspect letter — otherwise we'd mangle real text.
        if not any(c.isdigit() for c in tok):
            return tok
        if not any(c in "loIgS'" for c in tok):
            return tok
        return tok.translate(_OCR_DIGIT_MAP)

    return _OCR_HEAL_RE.sub(_fix_tok, line)


def _fix_broken_thousand_separators(line: str) -> str:
    """Collapse space-as-thousand-separator ONLY when the second chunk
    has a decimal point — that's the signal the whole thing is one real
    number (e.g. '5 292.60' → '5,292.60'). Applied up to 3× per line so
    two-level separators like '18 651.20' and '1 234 567.89' all heal.
    Also applies OCR digit healing for l/o/I/g→digit substitutions."""
    prev = None
    cur = _heal_ocr_digits(line)
    for _ in range(3):
        if cur == prev:
            break
        prev = cur
        cur = BROKEN_SEP_RE.sub(r"\1,\2", cur)
    return cur


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
        # Cap section body at 80 KB — covers the P&L + notes + first few
        # tables even for banks (where the data can sit ~700 lines below
        # the header). Some filings don't have a next section header
        # inside the first 30 PDF pages, so without the cap we'd scan
        # auditor reports, balance sheets, etc. — which don't match our
        # canonical labels so the scan falls off naturally, but 80 KB
        # is plenty and keeps memory bounded.
        end = min(end, start + 80_000)
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

    Special alias: "owners of the company" is the attribution sub-line in
    consolidated filings ("Profit attributable to: / Owners of the Company
    10,839.18"). Because "Owners of the Company" also appears in balance-sheet
    equity lines, this alias is only valid when the IMMEDIATELY preceding
    non-empty line contains "profit attributable".
    """
    # Heal the whole section up-front so numeric detection works on lines
    # with space-as-thousand-separator.
    healed_lines = [_fix_broken_thousand_separators(l) for l in section.splitlines()]
    lc_lines = [l.lower() for l in healed_lines]
    for a in (s.lower() for s in aliases):
        for idx, (line, lc) in enumerate(zip(healed_lines, lc_lines)):
            if a not in lc:
                continue
            # Context guard for the attribution sub-line: only accept
            # "owners of the company" when the previous non-empty line
            # mentions "profit attributable".
            if a == "owners of the company":
                prev_lc = next(
                    (lc_lines[j] for j in range(idx - 1, -1, -1)
                     if lc_lines[j].strip()),
                    "",
                )
                if "profit attributable" not in prev_lc:
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


def _drop_leading_row_marker(toks: list[float]) -> list[float]:
    """If right-of-label tokens start with a small integer row marker like
    '5' from '(5-6)' or '7' preceding '292.60', AND the next token has a
    decimal part (the real data is floats), drop the leading integer.

    Empirically, data rows in SEBI templates always have decimal values
    (currency with paise, or lakh counts with cents). Pure integers appearing
    as the first token are almost always row markers or note references.
    """
    if len(toks) >= 2:
        a, b = toks[0], toks[1]
        is_small_int = (1 <= a <= 99) and float(int(a)) == a
        b_has_decimal = float(int(b)) != b
        if is_small_int and b_has_decimal:
            return toks[1:]
    return toks


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
    # Heal PDFs that render thousand separators as spaces (Persistent et al.).
    line = _fix_broken_thousand_separators(line)
    pos = line.lower().find(label)
    left_toks = numeric_tokens(line[:pos])
    right_toks = numeric_tokens(line[pos + len(label):])

    if len(left_toks) >= 3:
        return left_toks[0]
    if right_toks:
        # Row markers like "7 Profit for the period / year (5-6) 5 292.60"
        # can leak into right_toks as "5" (from "(5-6)"). Drop them if the
        # next token has a decimal (real data).
        right_toks = _drop_leading_row_marker(right_toks)
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

    # OCR fallback: when pdfplumber extracts little or no text, or it extracts
    # prose (cover letter) but no financial anchors, the financial TABLE is
    # likely rasterised inside the PDF (scanned filing). Rasterise and OCR.
    has_anchor = bool(re.search(
        r"revenue\s+from\s+operations|interest\s+earned|net\s+premium\s+earned|"
        r"income\s+from\s+operations",
        full, re.IGNORECASE,
    ))
    if not has_anchor or len(full) < 500:
        ocr_text = _try_ocr_fallback(pdf_bytes)
        if ocr_text:
            full = (full + "\n\n" + ocr_text) if full else ocr_text
            result["text_chars"] = len(full)
            result["ocr_applied"] = True
        elif len(full) < 500:
            result["error"] = "pdf appears image-scanned (OCR unavailable or failed)"
            return result

    sections = split_sections(full)
    # Prefer consolidated. Fall back to standalone. Fall back to the
    # "generic" (unqualified) section header.
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

    # Sanity check: the section we picked must actually contain a financial
    # anchor line ("Revenue from operations" / "Interest earned" / etc.).
    # Some PDFs have the phrase "standalone financial results" buried in
    # notes prose (GROWW), which fools our section regex into returning
    # a tiny irrelevant block. If that happens, fall back to full text —
    # we'd rather parse too much than too little.
    anchor_re = re.compile(
        r"(revenue\s+from\s+operations|interest\s+earned|net\s+premium\s+earned|"
        r"income\s+from\s+operations)",
        re.IGNORECASE,
    )
    if not anchor_re.search(section_text) and anchor_re.search(full):
        section_text, section_name = full, section_name or "fallback_full"
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
        cutoff = _days_ago_ist(args.days)
        events = sb.table("announcement_events") \
            .select("id,ticker,announcement_date,raw_json,companies!inner(id,company_name,is_active)") \
            .eq("status", "fetched") \
            .gte("announcement_date", cutoff) \
            .lte("announcement_date", _today_ist()) \
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


def sanity_check_revenue(sb, ticker: str, parsed_revenue: float | None) -> tuple[bool, str]:
    """Compare parsed revenue against historical median to catch OCR errors.

    Returns (ok, reason). If not ok the caller should skip the write and log
    a warning instead of writing a bad number to the DB.

    Bounds are deliberately generous — we only want to catch egregious OCR
    misreads (e.g. Union Bank ₹0.003 Cr vs historical ₹24 000 Cr), not
    genuine business swings (±50 % QoQ is common for cyclical sectors).

    Thresholds:
      Low:  parsed < 5 % of historical median → very likely OCR-picked wrong cell
      High: parsed > 20× historical median    → very likely column-join or unit error
    """
    if parsed_revenue is None:
        return True, ""          # Nothing to check
    if parsed_revenue <= 0:
        return True, ""          # Negative/zero revenue is allowed (holding cos)

    historical = sb.table("quarterly_financials") \
        .select("revenue") \
        .eq("ticker", ticker) \
        .not_.is_("revenue", "null") \
        .gt("revenue", 0) \
        .order("quarter_end_date", desc=True) \
        .limit(8) \
        .execute().data or []

    revenues = [r["revenue"] for r in historical
                if r.get("revenue") is not None and r["revenue"] > 0]
    if len(revenues) < 2:
        return True, ""          # Not enough history for a meaningful check

    revenues.sort()
    n = len(revenues)
    median = revenues[n // 2] if n % 2 else (revenues[n // 2 - 1] + revenues[n // 2]) / 2
    if median <= 0:
        return True, ""

    ratio = parsed_revenue / median
    if ratio < 0.05:
        return (
            False,
            f"parsed revenue {parsed_revenue/1e7:.2f} Cr is only {ratio*100:.1f}% of "
            f"historical median {median/1e7:.2f} Cr — likely OCR misread"
        )
    if ratio > 20:
        return (
            False,
            f"parsed revenue {parsed_revenue/1e7:.2f} Cr is {ratio:.1f}× "
            f"historical median {median/1e7:.2f} Cr — likely column-join or unit error"
        )
    return True, ""


def upsert_row(sb, company: dict, ticker: str, ann_date: date, parsed: dict,
               filing_url: str, quarter_end: date) -> dict:
    """Write to quarterly_financials. Returns {'written': bool, 'reason': str}."""
    fy, fq, label = to_fiscal(quarter_end)

    missing = sum(v is None for v in (parsed.get("revenue"), parsed.get("net_profit")))
    quality = "ok" if missing == 0 else ("partial" if missing == 1 else "missing")

    if parsed.get("revenue") is None and parsed.get("net_profit") is None:
        return {"written": False, "reason": "no rev/np extracted"}

    # Sanity-check revenue against historical median — catches OCR misreads
    # (e.g. Union Bank where OCR read ₹31.85 L instead of ₹24 000 Cr).
    sane, why = sanity_check_revenue(sb, ticker, parsed.get("revenue"))
    if not sane:
        return {"written": False, "reason": f"sanity check failed: {why}"}

    # Sanity-check: NP > Revenue is structurally impossible (even for banks,
    # treasury income doesn't exceed total interest income). Catches cases
    # where the parser picks a balance-sheet equity line or annual summary
    # instead of the quarterly PAT row.
    rev = parsed.get("revenue")
    np_ = parsed.get("net_profit")
    if rev and np_ and np_ > 0 and rev > 0 and np_ > rev * 1.5:
        return {
            "written": False,
            "reason": f"sanity check failed: NP {np_/1e7:.0f}Cr > 1.5× Revenue {rev/1e7:.0f}Cr",
        }

    # Source hierarchy: nse > bse_pdf > screener.
    # bse_pdf CAN overwrite a screener row, but ONLY when our parse produced
    # a complete result (both revenue AND net_profit present). Partial bse_pdf
    # writes (e.g. revenue-only or NP-only) leave the existing screener row
    # intact, because a partial official source is no better than a complete
    # scraped one — and may introduce inconsistency.
    existing = sb.table("quarterly_financials").select("source,data_quality_status") \
        .eq("ticker", ticker).eq("quarter_end_date", quarter_end.isoformat()) \
        .limit(1).execute().data or []
    if existing:
        src = existing[0].get("source", "")
        qual = existing[0].get("data_quality_status", "")
        # nse is always more authoritative than bse_pdf — never overwrite.
        if src == "nse":
            return {"written": False, "reason": "already have nse row"}
        # bse (calendar grid, not PDF) is also authoritative — skip.
        if src == "bse" and qual == "ok":
            return {"written": False, "reason": "already have bse row"}
        # For screener rows: only overwrite when bse_pdf produced a COMPLETE
        # result. A partial bse_pdf parse is not worth clobbering good screener data.
        if src == "screener" and qual == "ok" and quality != "ok":
            return {
                "written": False,
                "reason": f"partial bse_pdf ({quality}) won't overwrite complete screener row",
            }

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
