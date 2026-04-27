"""
Related Coverage fetcher ("In Context" section).

Strategy — two complementary sources:

  1. Direct RSS feeds from credible Indian business news outlets (primary).
     These give us real article URLs, a known source name per feed, and
     India-focused financial news without geo-blocking or rate limits.

  2. Google News RSS queries per leading/lagging sector (supplementary).
     Adds sector-targeted articles that the broad feeds may miss.
     Falls back gracefully if Google blocks the request from CI IPs.

After collecting articles, the script:
  - Filters titles by sector/company keywords (relevance gate)
  - Deduplicates by source_url
  - Upserts to related_coverage (unique on source_url)
  - Deactivates articles older than 7 days

Run:
    py scripts/fetch_related_coverage.py
    py scripts/fetch_related_coverage.py --quarter "Q4 FY26"
    py scripts/fetch_related_coverage.py --dry-run
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

from supabase import create_client

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
)

_IST = timezone(timedelta(hours=5, minutes=30))


# ---------------------------------------------------------------------------
# Direct RSS feeds — primary source.
# Each entry: (feed_url, display_name, max_items)
# ---------------------------------------------------------------------------
DIRECT_FEEDS: list[tuple[str, str, int]] = [
    # Economic Times — earnings & results beat
    (
        "https://economictimes.indiatimes.com/markets/earnings/rss.cms",
        "Economic Times", 10,
    ),
    # Economic Times — broad markets
    (
        "https://economictimes.indiatimes.com/markets/rss.cms",
        "Economic Times", 6,
    ),
    # Business Standard — markets
    (
        "https://www.business-standard.com/rss/markets-106.rss",
        "Business Standard", 8,
    ),
    # Mint — markets
    (
        "https://www.livemint.com/rss/markets",
        "Mint", 8,
    ),
    # Moneycontrol — top news
    (
        "https://www.moneycontrol.com/rss/MCtopnews.xml",
        "Moneycontrol", 6,
    ),
]

# Google News RSS — supplementary, sector-targeted.
GNEWS_BASE = "https://news.google.com/rss/search"

# Credible source whitelist for Google News (direct feeds don't need this).
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
    "Energy":          {"q": "india oil gas energy refinery quarterly results earnings",
                        "kw": ["oil", "gas", "energy", "refin", "petrol", "ongc", "reliance"]},
    "Consumer Goods":  {"q": "india FMCG consumer goods quarterly results earnings",
                        "kw": ["fmcg", "consumer", "hul", "nestle", "dabur", "marico"]},
    "Pharmaceuticals": {"q": "india pharma pharmaceutical quarterly results earnings",
                        "kw": ["pharma", "drug", "medicine", "api", "cipla", "sun pharma"]},
    "Metals":          {"q": "india steel metals mining quarterly results earnings",
                        "kw": ["steel", "metal", "alumin", "copper", "mining", "tata steel", "jsw"]},
    "Automobiles":     {"q": "india automobile auto quarterly results earnings",
                        "kw": ["auto", "car", "vehicle", "ev", "maruti", "tata motors", "m&m"]},
    "Real Estate":     {"q": "india real estate realty housing quarterly results",
                        "kw": ["real estate", "realty", "housing", "property", "dlf", "prestige"]},
    "Telecom":         {"q": "india telecom quarterly results earnings",
                        "kw": ["telecom", "jio", "airtel", "vi ", "vodafone", "bsnl"]},
    "Infrastructure":  {"q": "india infrastructure construction EPC quarterly results",
                        "kw": ["infra", "construction", "epc", "road", "highway", "l&t"]},
    "Cement":          {"q": "india cement quarterly results earnings",
                        "kw": ["cement", "ultratech", "ambuja", "acc", "shree cement"]},
    "Power":           {"q": "india power electricity utilities quarterly results",
                        "kw": ["power", "electricity", "ntpc", "tata power", "adani power"]},
}

# Generic earnings keywords — used to filter direct-feed articles.
EARNINGS_KEYWORDS = [
    "quarterly", "results", "q4", "q3", "q2", "q1", "earnings", "profit",
    "revenue", "net profit", "ebitda", "margin", "fy26", "fy25", "fy2026",
    "annual", "turnover", "beats", "misses", "inline", "crore", "lakh",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
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


def is_earnings_relevant(title: str) -> bool:
    """True if the title contains at least one earnings-related keyword."""
    t = title.lower()
    return any(kw in t for kw in EARNINGS_KEYWORDS)


def sector_matches(title: str, sector: str) -> bool:
    """True if the title contains a sector keyword."""
    info = SECTOR_INFO.get(sector, {})
    keywords = info.get("kw", [sector.lower()])
    t = title.lower()
    return any(kw in t for kw in keywords)


# ---------------------------------------------------------------------------
# Feed parsers
# ---------------------------------------------------------------------------
def fetch_direct_feed(
    feed_url: str,
    source_name: str,
    max_items: int = 10,
    sector_filter: str | None = None,
) -> list[dict]:
    """
    Fetch a direct RSS feed and return earnings-relevant articles.
    If sector_filter is given, also require a sector keyword match.
    """
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

        # Relevance gates
        if not is_earnings_relevant(title):
            continue
        if sector_filter and not sector_matches(title, sector_filter):
            continue

        results.append({
            "title":        title,
            "commentary":   truncate(title, 20),
            "source_name":  source_name,
            "source_url":   link,
            "published_at": parse_pub_date(entry),
        })

    return results


def fetch_gnews(query: str, max_items: int = 6) -> list[dict]:
    """
    Fetch Google News RSS for a query — supplementary, sector-targeted.
    Returns only articles from CREDIBLE_SOURCES whitelist.
    """
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

        # Extract source — Google News puts it in entry.source
        raw_src = ""
        src_obj = getattr(entry, "source", None)
        if src_obj is not None:
            raw_src = (
                src_obj.get("title", "")
                if hasattr(src_obj, "get")
                else getattr(src_obj, "title", "")
            ) or ""

        # Fallback: parse from title suffix
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
            "commentary":   truncate(title, 20),
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
        curr = (
            sb.table("quarterly_financials")
            .select("ticker,revenue,companies!inner(sector,is_active)")
            .eq("quarter_label", quarter)
            .eq("companies.is_active", True)
            .not_.is_("revenue", "null")
            .execute()
        )
        prior = (
            sb.table("quarterly_financials")
            .select("ticker,revenue")
            .eq("quarter_label", prior_label)
            .not_.is_("revenue", "null")
            .execute()
        )
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
        if len(yoys) < 2:   # lower threshold than before
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
        curr = (
            sb.table("quarterly_financials")
            .select("ticker,net_profit,companies!inner(company_name,sector,is_active)")
            .eq("quarter_label", quarter)
            .eq("companies.is_active", True)
            .not_.is_("net_profit", "null")
            .execute()
        )
        prior = (
            sb.table("quarterly_financials")
            .select("ticker,net_profit")
            .eq("quarter_label", prior_label)
            .not_.is_("net_profit", "null")
            .execute()
        )
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
        row = {**item, "is_active": True, "updated_at": now_iso}
        if dry_run:
            print(f"  [dry] {item['source_name']:22s} | {item['title'][:70]}")
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
    ap.add_argument("--quarter", default=os.environ.get("FETCH_QUARTER", "Q4 FY26"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-direct", type=int, default=8,
                    help="max items per direct RSS feed")
    ap.add_argument("--max-gnews", type=int, default=5,
                    help="max items per Google News query")
    args = ap.parse_args()

    if not args.dry_run and (not SUPABASE_URL or not SUPABASE_KEY):
        print("Missing SUPABASE credentials", file=sys.stderr)
        return 2

    sb = create_client(SUPABASE_URL, SUPABASE_KEY) if not args.dry_run else None
    print(f"In Context fetch — {args.quarter}")

    # 1. Context: sector performance + outliers
    sectors: dict[str, dict] = {}
    outliers: list[dict] = []
    active_sectors: list[str] = []
    if sb:
        print("  Loading sector performance…")
        sectors = get_sector_performance(sb, args.quarter)
        active_sectors = [s for s in sectors]
        print(f"  Active sectors: {active_sectors or '(none — will use broad feeds)'}")
        outliers = get_outlier_companies(sb, args.quarter)
        print(f"  Outlier companies: {[o['company_name'] for o in outliers]}")

    all_items: list[dict] = []
    seen_urls: set[str] = set()

    def add_items(items: list[dict], sector: str | None, company: str | None, reason: str) -> None:
        for art in items:
            url = art.get("source_url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            art["matched_sector"]  = sector
            art["matched_company"] = company
            art["match_reason"]    = reason
            all_items.append(art)

    # 2. Direct feeds — broad earnings coverage
    print(f"\n  -- Direct RSS feeds --")
    for feed_url, source_name, max_n in DIRECT_FEEDS:
        print(f"  {source_name}: {feed_url[:60]}")
        items = fetch_direct_feed(feed_url, source_name, max_items=max_n)
        print(f"    → {len(items)} earnings articles")
        # Tag items with the most-relevant sector from our active list
        for art in items:
            best_sector = None
            for s in active_sectors:
                if sector_matches(art["title"], s):
                    best_sector = s
                    break
            add_items(
                [art], best_sector, None,
                f"Direct feed — {source_name}"
            )
        time.sleep(0.5)

    # 3. Google News — sector-targeted supplement
    sorted_sectors = sorted(
        sectors.items(), key=lambda kv: abs(kv[1]["avg_yoy"]), reverse=True
    )
    if sorted_sectors:
        print(f"\n  -- Google News (top sectors) --")
    for sector, data in sorted_sectors[:3]:
        info = SECTOR_INFO.get(sector, {})
        q = info.get("q", f"india {sector.lower()} quarterly results earnings")
        verb = "leading" if data["direction"] == "up" else "lagging" if data["direction"] == "down" else "flat"
        reason = f"{sector} {verb} ({data['avg_yoy']:+.1f}% avg rev YoY)"
        print(f"  {sector} ({verb}): {q[:50]}")
        items = fetch_gnews(q, max_items=args.max_gnews)
        print(f"    → {len(items)} articles from credible sources")
        add_items(items, sector, None, reason)
        time.sleep(0.8)

    # Outlier-targeted Google News
    for o in outliers[:2]:
        first_word = o["company_name"].split()[0]
        q = f"india {first_word} quarterly results earnings profit"
        reason = f"{o['company_name']} profit outlier ({o['profit_yoy']:.0f}% YoY)"
        print(f"  Outlier {o['company_name']}: {q[:50]}")
        items = fetch_gnews(q, max_items=3)
        print(f"    → {len(items)} articles")
        add_items(items, o.get("sector"), o["company_name"], reason)
        time.sleep(0.8)

    print(f"\n  Total unique articles: {len(all_items)}")

    # 4. Save
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
