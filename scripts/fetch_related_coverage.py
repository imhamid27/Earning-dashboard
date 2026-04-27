"""
Related Coverage fetcher ("In Context" section).

Strategy — two complementary sources:

  1. Direct RSS feeds from credible Indian business news outlets (primary).
  2. Google News RSS queries per leading/lagging sector (supplementary).

For each article we call Claude Haiku to write a 2-sentence investor brief
(stored in `commentary`) so the card shows an Inshorts-style digest rather
than just repeating the headline.

Run:
    py scripts/fetch_related_coverage.py
    py scripts/fetch_related_coverage.py --quarter "Q4 FY26"
    py scripts/fetch_related_coverage.py --dry-run
    py scripts/fetch_related_coverage.py --no-briefs   # skip Claude, use title
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

try:
    import feedparser
except ImportError:
    raise ImportError("feedparser is required: pip install feedparser")

try:
    import anthropic as _anthropic
    _HAS_ANTHROPIC = True
except ImportError:
    _HAS_ANTHROPIC = False

from supabase import create_client

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
)
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

_IST = timezone(timedelta(hours=5, minutes=30))


# ---------------------------------------------------------------------------
# Direct RSS feeds — primary source.
# Each entry: (feed_url, display_name, max_items)
# ---------------------------------------------------------------------------
DIRECT_FEEDS: list[tuple[str, str, int]] = [
    ("https://economictimes.indiatimes.com/markets/earnings/rss.cms",
     "Economic Times", 10),
    ("https://economictimes.indiatimes.com/markets/rss.cms",
     "Economic Times", 6),
    ("https://www.business-standard.com/rss/markets-106.rss",
     "Business Standard", 8),
    ("https://www.livemint.com/rss/markets",
     "Mint", 8),
    ("https://www.moneycontrol.com/rss/MCtopnews.xml",
     "Moneycontrol", 6),
]

GNEWS_BASE = "https://news.google.com/rss/search"

CREDIBLE_SOURCES: list[tuple[str, str]] = [
    ("the core",           "The Core"),
    ("thecore",            "The Core"),
    ("reuters",            "Reuters"),
    ("business standard",  "Business Standard"),
    ("livemint",           "Mint"),
    ("mint",               "Mint"),
    ("bloomberg",          "Bloomberg"),
    ("economic times",     "Economic Times"),
    ("moneycontrol",       "Moneycontrol"),
    ("financial express",  "Financial Express"),
    ("cnbc tv18",          "CNBC TV18"),
    ("cnbctv18",           "CNBC TV18"),
    ("ndtv profit",        "NDTV Profit"),
]


def match_source(raw: str) -> str | None:
    s = raw.lower()
    for keyword, display in CREDIBLE_SOURCES:
        if keyword in s:
            return display
    return None


# ---------------------------------------------------------------------------
# Sector → Google News query + relevance keywords
# ---------------------------------------------------------------------------
SECTOR_INFO: dict[str, dict] = {
    "Financials":      {"q": "india banking NBFC finance quarterly results earnings",
                        "kw": ["bank", "nbfc", "financial", "lending", "credit", "insurance", "npa"]},
    "Technology":      {"q": "india IT software technology quarterly results earnings",
                        "kw": ["it ", "software", "tech", "infosys", "tcs", "wipro", "hcl"]},
    "Information Technology": {"q": "india IT software technology quarterly results earnings",
                        "kw": ["it ", "software", "tech", "infosys", "tcs", "wipro", "hcl"]},
    "Energy":          {"q": "india oil gas energy refinery quarterly results earnings",
                        "kw": ["oil", "gas", "energy", "refin", "petrol", "ongc", "reliance"]},
    "Consumer Goods":  {"q": "india FMCG consumer goods quarterly results earnings",
                        "kw": ["fmcg", "consumer", "hul", "nestle", "dabur", "marico"]},
    "Consumer Staples":{"q": "india FMCG consumer goods quarterly results earnings",
                        "kw": ["fmcg", "consumer", "hul", "nestle", "dabur", "marico"]},
    "Pharmaceuticals": {"q": "india pharma pharmaceutical quarterly results earnings",
                        "kw": ["pharma", "drug", "medicine", "api", "cipla", "sun pharma"]},
    "Healthcare":      {"q": "india pharma healthcare quarterly results earnings",
                        "kw": ["pharma", "drug", "hospital", "healthcare", "cipla", "sun pharma"]},
    "Materials":       {"q": "india steel metals materials quarterly results earnings",
                        "kw": ["steel", "metal", "alumin", "copper", "mining", "cement"]},
    "Automobiles":     {"q": "india automobile auto quarterly results earnings",
                        "kw": ["auto", "car", "vehicle", "ev", "maruti", "tata motors", "m&m"]},
    "Consumer Discretionary": {"q": "india consumer discretionary auto retail quarterly results",
                        "kw": ["auto", "car", "retail", "jewel", "titan", "maruti"]},
    "Real Estate":     {"q": "india real estate realty housing quarterly results",
                        "kw": ["real estate", "realty", "housing", "property", "dlf"]},
    "Communication Services": {"q": "india telecom quarterly results earnings",
                        "kw": ["telecom", "jio", "airtel", "vi ", "vodafone"]},
    "Infrastructure":  {"q": "india infrastructure construction EPC quarterly results",
                        "kw": ["infra", "construction", "epc", "road", "highway", "l&t"]},
    "Utilities":       {"q": "india power electricity utilities quarterly results",
                        "kw": ["power", "electricity", "ntpc", "tata power", "adani power"]},
    "Industrials":     {"q": "india industrials capital goods quarterly results",
                        "kw": ["industrial", "capital goods", "engineering", "defence", "l&t"]},
    "Capital Goods":   {"q": "india capital goods engineering quarterly results earnings",
                        "kw": ["capital goods", "engineering", "defence", "bhel", "siemens"]},
}

EARNINGS_KEYWORDS = [
    "quarterly", "results", "q4", "q3", "q2", "q1", "earnings", "profit",
    "revenue", "net profit", "ebitda", "margin", "fy26", "fy25", "fy2026",
    "annual", "turnover", "beats", "misses", "inline", "crore", "lakh",
]


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------
def strip_html(text: str) -> str:
    """Remove HTML tags and normalise whitespace."""
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def truncate(text: str, max_words: int = 20) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + "…"


def strip_source_suffix(title: str, source_name: str) -> str:
    """Remove ' - Source Name' suffix that some feeds append."""
    for sep in (" — ", " – ", " - "):
        if title.endswith(sep + source_name):
            return title[: -(len(sep) + len(source_name))].strip()
    return title.strip()


def parse_pub_date(entry) -> str | None:
    pp = getattr(entry, "published_parsed", None)
    if pp:
        try:
            return datetime(*pp[:6], tzinfo=timezone.utc).isoformat()
        except Exception:
            pass
    return None


def extract_description(entry) -> str:
    """Pull the best available description text from a feedparser entry."""
    for attr in ("summary", "description", "content"):
        val = getattr(entry, attr, None)
        if not val:
            continue
        if isinstance(val, list) and val:
            val = val[0].get("value", "") if hasattr(val[0], "get") else str(val[0])
        text = strip_html(str(val))
        if len(text) > 40:          # meaningful, not just a date or tag
            return text[:800]       # cap to avoid huge prompts
    return ""


def is_earnings_relevant(title: str) -> bool:
    t = title.lower()
    return any(kw in t for kw in EARNINGS_KEYWORDS)


def sector_matches(title: str, sector: str) -> bool:
    info = SECTOR_INFO.get(sector, {})
    keywords = info.get("kw", [sector.lower()])
    t = title.lower()
    return any(kw in t for kw in keywords)


# ---------------------------------------------------------------------------
# Claude brief generator
# ---------------------------------------------------------------------------
_BRIEF_PROMPT = """\
You are writing 2-sentence investor briefs for an Indian corporate earnings dashboard.

Given a news headline (and optional article description), write exactly 2 sentences:
1. The core fact — include specific figures (profit up/down X%, revenue ₹Y cr, etc.)
2. What it means for investors or the sector outlook.

Rules: Under 50 words total. Plain English, no bullet points, no markdown. \
Use ₹ for rupee amounts. Do not start with "The company" or repeat the source name.

Headline: {title}
{desc_block}"""


def make_brief_client():
    """Return an Anthropic client if the API key is available, else None."""
    if not _HAS_ANTHROPIC:
        print("  [info] anthropic package not installed — skipping AI briefs", file=sys.stderr)
        return None
    if not ANTHROPIC_API_KEY:
        print("  [info] ANTHROPIC_API_KEY not set — skipping AI briefs", file=sys.stderr)
        return None
    return _anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


def generate_briefs(client, items: list[dict]) -> None:
    """
    For each item that has a non-empty `_raw_desc`, call Claude Haiku and
    store the result in `commentary`.  Mutates items in-place.
    Falls back to a truncated title if the API call fails.
    """
    if not client:
        for item in items:
            item["commentary"] = truncate(item["title"], 30)
        return

    print(f"  Generating AI briefs for {len(items)} articles…")
    for i, item in enumerate(items, 1):
        title = item["title"]
        desc  = item.get("_raw_desc", "")
        desc_block = f"Description: {desc}" if desc else ""
        prompt = _BRIEF_PROMPT.format(title=title, desc_block=desc_block)
        try:
            resp = client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=120,
                messages=[{"role": "user", "content": prompt}],
            )
            brief = resp.content[0].text.strip()
            item["commentary"] = brief
        except Exception as e:
            print(f"  [warn] brief {i}/{len(items)} failed: {e}", file=sys.stderr)
            item["commentary"] = truncate(title, 30)
        # Small pause to respect rate limits
        if i % 10 == 0:
            time.sleep(1)


# ---------------------------------------------------------------------------
# Feed parsers
# ---------------------------------------------------------------------------
def fetch_direct_feed(
    feed_url: str,
    source_name: str,
    max_items: int = 10,
    sector_filter: str | None = None,
) -> list[dict]:
    try:
        feed = feedparser.parse(
            feed_url,
            request_headers={"User-Agent": "EarningsDashboard/1.0"},
        )
    except Exception as e:
        print(f"  [warn] direct feed error ({source_name}): {e}", file=sys.stderr)
        return []

    if getattr(feed, "bozo", False) and not feed.entries:
        print(f"  [warn] malformed feed from {source_name}", file=sys.stderr)
        return []

    results: list[dict] = []
    for entry in feed.entries:
        if len(results) >= max_items:
            break
        raw_title = getattr(entry, "title", "") or ""
        link = getattr(entry, "link", "") or ""
        if not raw_title or not link:
            continue

        title = strip_source_suffix(raw_title, source_name)
        if not title:
            continue
        if not is_earnings_relevant(title):
            continue
        if sector_filter and not sector_matches(title, sector_filter):
            continue

        results.append({
            "title":        title,
            "commentary":   "",             # filled later by generate_briefs()
            "_raw_desc":    extract_description(entry),
            "source_name":  source_name,
            "source_url":   link,
            "published_at": parse_pub_date(entry),
        })

    return results


def fetch_gnews(query: str, max_items: int = 6) -> list[dict]:
    url = (
        f"{GNEWS_BASE}?q={urllib.parse.quote(query)}"
        "&hl=en-IN&gl=IN&ceid=IN:en"
    )
    try:
        feed = feedparser.parse(
            url,
            request_headers={"User-Agent": "EarningsDashboard/1.0"},
        )
    except Exception as e:
        print(f"  [warn] gnews error for '{query[:40]}': {e}", file=sys.stderr)
        return []

    results: list[dict] = []
    for entry in getattr(feed, "entries", []):
        if len(results) >= max_items:
            break

        raw_title = getattr(entry, "title", "") or ""
        link = getattr(entry, "link", "") or ""
        if not raw_title or not link:
            continue

        raw_src = ""
        src_obj = getattr(entry, "source", None)
        if src_obj is not None:
            raw_src = (
                src_obj.get("title", "")
                if hasattr(src_obj, "get")
                else getattr(src_obj, "title", "")
            ) or ""

        if not raw_src:
            for sep in (" — ", " – ", " - "):
                if sep in raw_title:
                    raw_src = raw_title.rsplit(sep, 1)[-1].strip()
                    break

        source_name = match_source(raw_src) if raw_src else None
        if not source_name:
            continue

        title = strip_source_suffix(raw_title, source_name)
        if not title:
            continue

        results.append({
            "title":        title,
            "commentary":   "",
            "_raw_desc":    extract_description(entry),
            "source_name":  source_name,
            "source_url":   link,
            "published_at": parse_pub_date(entry),
        })

    return results


# ---------------------------------------------------------------------------
# DB context
# ---------------------------------------------------------------------------
def get_sector_performance(sb, quarter: str) -> dict[str, dict]:
    m = re.match(r"^Q([1-4])\s*FY(\d{2})$", quarter.strip())
    if not m:
        return {}
    fq = int(m.group(1))
    fy = 2000 + int(m.group(2))
    prior_label = f"Q{fq} FY{str(fy - 1)[-2:]}"

    try:
        curr  = (sb.table("quarterly_financials")
                   .select("ticker,revenue,companies!inner(sector,is_active)")
                   .eq("quarter_label", quarter)
                   .eq("companies.is_active", True)
                   .not_.is_("revenue", "null")
                   .execute())
        prior = (sb.table("quarterly_financials")
                   .select("ticker,revenue")
                   .eq("quarter_label", prior_label)
                   .not_.is_("revenue", "null")
                   .execute())
    except Exception as e:
        print(f"  [warn] sector query failed: {e}", file=sys.stderr)
        return {}

    prior_by = {r["ticker"]: r["revenue"] for r in (prior.data or [])}
    sector_yoys: dict[str, list[float]] = {}
    for r in curr.data or []:
        c = r.get("companies") or {}
        sector = c.get("sector")
        if not sector:
            continue
        rev = r.get("revenue")
        prev_rev = prior_by.get(r["ticker"])
        if rev and prev_rev and prev_rev > 0:
            sector_yoys.setdefault(sector, []).append(
                (rev - prev_rev) / prev_rev * 100
            )

    out: dict[str, dict] = {}
    for sector, yoys in sector_yoys.items():
        if len(yoys) < 2:
            continue
        avg = sum(yoys) / len(yoys)
        out[sector] = {
            "avg_yoy":   avg,
            "count":     len(yoys),
            "direction": "up" if avg > 3 else ("down" if avg < -3 else "flat"),
        }
    return out


def get_outlier_companies(sb, quarter: str, top_n: int = 3) -> list[dict]:
    m = re.match(r"^Q([1-4])\s*FY(\d{2})$", quarter.strip())
    if not m:
        return []
    fq = int(m.group(1))
    fy = 2000 + int(m.group(2))
    prior_label = f"Q{fq} FY{str(fy - 1)[-2:]}"

    try:
        curr  = (sb.table("quarterly_financials")
                   .select("ticker,net_profit,companies!inner(company_name,sector,is_active)")
                   .eq("quarter_label", quarter)
                   .eq("companies.is_active", True)
                   .not_.is_("net_profit", "null")
                   .execute())
        prior = (sb.table("quarterly_financials")
                   .select("ticker,net_profit")
                   .eq("quarter_label", prior_label)
                   .not_.is_("net_profit", "null")
                   .execute())
    except Exception as e:
        print(f"  [warn] outlier query failed: {e}", file=sys.stderr)
        return []

    prior_by = {
        r["ticker"]: r["net_profit"]
        for r in (prior.data or [])
        if r.get("net_profit")
    }
    movers: list[dict] = []
    for r in curr.data or []:
        np_ = r.get("net_profit")
        pnp = prior_by.get(r["ticker"])
        if np_ and pnp and pnp != 0:
            c = r.get("companies") or {}
            movers.append({
                "ticker":       r["ticker"],
                "company_name": c.get("company_name", r["ticker"]),
                "sector":       c.get("sector"),
                "profit_yoy":   abs((np_ - pnp) / abs(pnp)) * 100,
            })

    movers.sort(key=lambda x: x["profit_yoy"], reverse=True)
    return movers[:top_n]


# ---------------------------------------------------------------------------
# DB write
# ---------------------------------------------------------------------------
def upsert_items(sb, items: list[dict], dry_run: bool = False) -> int:
    if not items:
        return 0
    now_iso = datetime.now(timezone.utc).isoformat()
    written = 0
    for item in items:
        if not item.get("source_url") or not item.get("source_name") or not item.get("title"):
            continue
        # Strip private fields before sending to Supabase
        row = {
            k: v for k, v in item.items()
            if not k.startswith("_")
        }
        row["is_active"] = True
        row["updated_at"] = now_iso
        if dry_run:
            brief = item.get("commentary", "")[:80]
            print(f"  [dry] {item['source_name']:20s} | {item['title'][:55]}")
            if brief:
                print(f"         brief: {brief}")
            written += 1
            continue
        try:
            sb.table("related_coverage").upsert(row, on_conflict="source_url").execute()
            written += 1
        except Exception as e:
            print(f"  [warn] upsert failed: {e}", file=sys.stderr)
    return written


def deactivate_old(sb, days: int = 7) -> None:
    try:
        cutoff = (datetime.now(_IST) - timedelta(days=days)).isoformat()
        sb.table("related_coverage").update(
            {"is_active": False, "updated_at": datetime.now(timezone.utc).isoformat()}
        ).lt("published_at", cutoff).execute()
    except Exception as e:
        print(f"  [warn] deactivate old: {e}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quarter",    default=os.environ.get("FETCH_QUARTER", "Q4 FY26"))
    ap.add_argument("--dry-run",    action="store_true")
    ap.add_argument("--no-briefs",  action="store_true",
                    help="Skip Claude AI briefs (uses truncated title instead)")
    ap.add_argument("--max-direct", type=int, default=8)
    ap.add_argument("--max-gnews",  type=int, default=5)
    args = ap.parse_args()

    if not args.dry_run and (not SUPABASE_URL or not SUPABASE_KEY):
        print("Missing SUPABASE credentials", file=sys.stderr)
        return 2

    sb     = create_client(SUPABASE_URL, SUPABASE_KEY) if not args.dry_run else None
    claude = None if args.no_briefs else make_brief_client()

    print(f"In Context fetch — {args.quarter}")

    # 1. Context from DB
    sectors: dict[str, dict] = {}
    outliers: list[dict] = []
    active_sectors: list[str] = []
    if sb:
        print("  Loading sector performance…")
        sectors = get_sector_performance(sb, args.quarter)
        active_sectors = list(sectors.keys())
        print(f"  Active sectors: {active_sectors or '(none)'}")
        outliers = get_outlier_companies(sb, args.quarter)
        print(f"  Outlier companies: {[o['company_name'] for o in outliers]}")

    all_items: list[dict] = []
    seen_urls: set[str] = set()

    def add_items(
        items: list[dict],
        sector: str | None,
        company: str | None,
        reason: str | None,
    ) -> None:
        for art in items:
            url = art.get("source_url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            art["matched_sector"]  = sector
            art["matched_company"] = company
            art["match_reason"]    = reason     # clean label, no "Direct feed" leak
            all_items.append(art)

    # 2. Direct RSS feeds
    print(f"\n  -- Direct RSS feeds --")
    for feed_url, source_name, max_n in DIRECT_FEEDS:
        print(f"  {source_name}: {feed_url[:65]}")
        items = fetch_direct_feed(feed_url, source_name, max_items=max_n)
        print(f"    → {len(items)} earnings articles")
        for art in items:
            # Tag with best matching sector from our active list
            best_sector = next(
                (s for s in active_sectors if sector_matches(art["title"], s)),
                None,
            )
            # match_reason: describe sector direction, not the feed source
            reason = None
            if best_sector and best_sector in sectors:
                d = sectors[best_sector]
                direction = "up" if d["direction"] == "up" else "down" if d["direction"] == "down" else "stable"
                reason = f"{best_sector} revenue {direction} {d['avg_yoy']:+.1f}% YoY"
            add_items([art], best_sector, None, reason)
        time.sleep(0.5)

    # 3. Google News — sector supplement
    sorted_sectors = sorted(
        sectors.items(), key=lambda kv: abs(kv[1]["avg_yoy"]), reverse=True
    )
    if sorted_sectors:
        print(f"\n  -- Google News (top sectors) --")
    for sector, data in sorted_sectors[:3]:
        info = SECTOR_INFO.get(sector, {})
        q    = info.get("q", f"india {sector.lower()} quarterly results earnings")
        direction = "up" if data["direction"] == "up" else "down" if data["direction"] == "down" else "stable"
        reason = f"{sector} revenue {direction} {data['avg_yoy']:+.1f}% YoY"
        print(f"  {sector} ({direction}): {q[:55]}")
        items = fetch_gnews(q, max_items=args.max_gnews)
        print(f"    → {len(items)} articles from credible sources")
        add_items(items, sector, None, reason)
        time.sleep(0.8)

    # Outlier-targeted
    for o in outliers[:2]:
        first_word = o["company_name"].split()[0]
        q      = f"india {first_word} quarterly results earnings profit"
        reason = f"{o['company_name']} profit {o['profit_yoy']:.0f}% YoY"
        print(f"  Outlier {o['company_name']}: {q[:55]}")
        items  = fetch_gnews(q, max_items=3)
        print(f"    → {len(items)} articles")
        add_items(items, o.get("sector"), o["company_name"], reason)
        time.sleep(0.8)

    print(f"\n  Total unique articles: {len(all_items)}")

    # 4. Generate AI briefs (in-place, before saving)
    generate_briefs(claude, all_items)

    # 5. Save
    written = upsert_items(sb, all_items, dry_run=args.dry_run)
    if sb:
        deactivate_old(sb, days=7)
    print(f"Done. {written} articles {'printed' if args.dry_run else 'saved/updated'}.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
