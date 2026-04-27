"""
Related Coverage fetcher.

Finds the leading/lagging sectors and top outlier companies from
quarterly_financials, builds targeted Google News RSS queries for each,
filters results to credible Indian business news sources, and saves to
the related_coverage table.

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
    raise ImportError(
        "feedparser is required: pip install feedparser"
    )

from supabase import create_client

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
)

_IST = timezone(timedelta(hours=5, minutes=30))


# ---------------------------------------------------------------------------
# Credible source whitelist.
# Order matters: first keyword match wins.
# ---------------------------------------------------------------------------
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
    """Return canonical display name, or None if not on the whitelist."""
    s = raw.lower()
    for keyword, display in CREDIBLE_SOURCES:
        if keyword in s:
            return display
    return None


# ---------------------------------------------------------------------------
# Sector → Google News search query
# ---------------------------------------------------------------------------
SECTOR_QUERIES: dict[str, str] = {
    "Financials":       "india banking NBFC finance quarterly results earnings",
    "Technology":       "india IT software technology quarterly results earnings",
    "Energy":           "india oil gas energy refinery quarterly results earnings",
    "Consumer Goods":   "india FMCG consumer goods quarterly results earnings",
    "Pharmaceuticals":  "india pharma pharmaceutical quarterly results earnings",
    "Metals":           "india steel metals mining quarterly results earnings",
    "Automobiles":      "india automobile auto quarterly results earnings",
    "Real Estate":      "india real estate realty housing quarterly results",
    "Telecom":          "india telecom quarterly results earnings",
    "Infrastructure":   "india infrastructure construction EPC quarterly results",
    "Cement":           "india cement quarterly results earnings",
    "Aviation":         "india aviation airline quarterly results earnings",
    "Insurance":        "india insurance sector quarterly results earnings",
    "Media":            "india media entertainment OTT quarterly results",
    "Power":            "india power electricity utilities quarterly results",
    "Chemicals":        "india chemicals specialty pharma quarterly results",
}
GENERAL_QUERY = "india Q4 FY26 corporate quarterly earnings results"

GNEWS_BASE = "https://news.google.com/rss/search"


# ---------------------------------------------------------------------------
# Title helpers
# ---------------------------------------------------------------------------
def clean_title(raw: str, source_name: str) -> str:
    """
    Remove the ' — Source' suffix Google News appends to titles.
    Handles em-dash, en-dash, and hyphen separators.
    """
    for sep in (" — ", " – ", " - "):
        suffix = sep + source_name
        if raw.endswith(suffix):
            return raw[: -len(suffix)].strip()
    # Also try all credible display names in case source_name is slightly off.
    for _, display in CREDIBLE_SOURCES:
        for sep in (" — ", " – ", " - "):
            if raw.endswith(sep + display):
                return raw[: -(len(sep) + len(display))].strip()
    return raw.strip()


def truncate(text: str, max_words: int = 20) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + "…"


# ---------------------------------------------------------------------------
# Google News RSS fetch + filter
# ---------------------------------------------------------------------------
def fetch_gnews(query: str, max_items: int = 8) -> list[dict]:
    """
    Fetch Google News RSS for a search query.
    Returns only items from CREDIBLE_SOURCES.
    Each item: {title, commentary, source_name, source_url, published_at}
    """
    url = (
        f"{GNEWS_BASE}?q={urllib.parse.quote(query)}"
        "&hl=en-IN&gl=IN&ceid=IN:en"
    )
    try:
        feed = feedparser.parse(url, agent="EarningsDashboard/1.0")
    except Exception as e:
        print(f"  [warn] feed error for '{query[:40]}': {e}", file=sys.stderr)
        return []

    results: list[dict] = []

    for entry in getattr(feed, "entries", []):
        if len(results) >= max_items:
            break

        raw_title = getattr(entry, "title", "") or ""
        link = getattr(entry, "link", "") or ""
        if not raw_title or not link:
            continue

        # Source name — Google News puts it in entry.source.title
        raw_src = ""
        src_obj = getattr(entry, "source", None)
        if isinstance(src_obj, dict):
            raw_src = src_obj.get("title", "")
        elif hasattr(src_obj, "title"):
            raw_src = src_obj.title or ""

        # Fallback: parse from title suffix
        if not raw_src:
            for sep in (" — ", " – ", " - "):
                if sep in raw_title:
                    raw_src = raw_title.rsplit(sep, 1)[-1].strip()
                    break

        source_name = match_source(raw_src) if raw_src else None
        if not source_name:
            continue

        title = clean_title(raw_title, source_name)
        if not title:
            continue

        # Published date
        pub_parsed = getattr(entry, "published_parsed", None)
        published_at: str | None = None
        if pub_parsed:
            try:
                published_at = datetime(*pub_parsed[:6], tzinfo=timezone.utc).isoformat()
            except Exception:
                pass

        results.append(
            {
                "title":        title,
                "commentary":   truncate(title, 20),
                "source_name":  source_name,
                "source_url":   link,
                "published_at": published_at,
            }
        )

    return results


# ---------------------------------------------------------------------------
# DB context: sector performance + outlier companies
# ---------------------------------------------------------------------------
def get_sector_performance(sb, quarter: str) -> dict[str, dict]:
    """
    Per-sector avg revenue YoY for the given quarter.
    Only includes sectors with ≥ 3 companies having both periods.
    """
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
        if len(yoys) < 3:
            continue
        avg = sum(yoys) / len(yoys)
        out[sector] = {
            "avg_yoy":   avg,
            "count":     len(yoys),
            "direction": "up" if avg > 5 else ("down" if avg < -5 else "flat"),
        }
    return out


def get_outlier_companies(sb, quarter: str, top_n: int = 3) -> list[dict]:
    """Biggest absolute profit movers for the quarter."""
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
            yoy_pct = abs((np_ - pnp) / abs(pnp)) * 100
            c = r.get("companies") or {}
            movers.append(
                {
                    "ticker":       r["ticker"],
                    "company_name": c.get("company_name", r["ticker"]),
                    "sector":       c.get("sector"),
                    "profit_yoy":   yoy_pct,
                }
            )

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
        if (
            not item.get("source_url")
            or not item.get("source_name")
            or not item.get("title")
        ):
            continue
        row = {**item, "is_active": True, "updated_at": now_iso}
        if dry_run:
            print(f"  [dry] {item['source_name']:20s} | {item['title'][:60]}")
            written += 1
            continue
        try:
            sb.table("related_coverage").upsert(
                row, on_conflict="source_url"
            ).execute()
            written += 1
        except Exception as e:
            print(
                f"  [warn] upsert failed for {item.get('source_url','?')[:60]}: {e}",
                file=sys.stderr,
            )
    return written


def deactivate_old(sb, days: int = 7) -> None:
    """Mark articles older than `days` as inactive so they don't appear in the feed."""
    try:
        cutoff = (datetime.now(_IST) - timedelta(days=days)).isoformat()
        sb.table("related_coverage").update(
            {
                "is_active":  False,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).lt("published_at", cutoff).execute()
    except Exception as e:
        print(f"  [warn] deactivate old failed: {e}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--quarter",
        default=os.environ.get("FETCH_QUARTER", "Q4 FY26"),
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="print fetched items without saving to DB",
    )
    ap.add_argument("--max-per-query", type=int, default=6)
    args = ap.parse_args()

    if not args.dry_run and (not SUPABASE_URL or not SUPABASE_KEY):
        print(
            "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
            file=sys.stderr,
        )
        return 2

    sb = (
        create_client(SUPABASE_URL, SUPABASE_KEY)
        if not args.dry_run
        else None
    )
    print(f"Related Coverage fetch — {args.quarter}")

    # 1. Context from DB
    sectors: dict[str, dict] = {}
    outliers: list[dict] = []
    if sb:
        print("  Fetching sector performance…")
        sectors = get_sector_performance(sb, args.quarter)
        print(f"  Sectors with data: {len(sectors)}")
        outliers = get_outlier_companies(sb, args.quarter)
        print(f"  Outlier companies: {len(outliers)}")

    # 2. Build query list — significant sectors first, then outliers, then general
    Rec = tuple[str, str | None, str | None, str]
    queries: list[Rec] = []

    sorted_sectors = sorted(
        sectors.items(), key=lambda kv: abs(kv[1]["avg_yoy"]), reverse=True
    )
    for sector, data in sorted_sectors[:4]:
        q = SECTOR_QUERIES.get(
            sector, f"india {sector.lower()} quarterly results earnings"
        )
        verb = (
            "leading"  if data["direction"] == "up"   else
            "lagging"  if data["direction"] == "down" else
            "flat"
        )
        reason = f"{sector} {verb} ({data['avg_yoy']:+.1f}% avg rev YoY, {data['count']} cos)"
        queries.append((q, sector, None, reason))

    for o in outliers:
        first_word = o["company_name"].split()[0]
        q = f"india {first_word} quarterly results earnings"
        reason = f"{o['company_name']} profit outlier ({o['profit_yoy']:.0f}% YoY)"
        queries.append((q, o.get("sector"), o["company_name"], reason))

    queries.append((GENERAL_QUERY, None, None, "General India Q4 FY26 earnings coverage"))

    # 3. Fetch articles and deduplicate by URL
    all_items: list[dict] = []
    seen_urls: set[str] = set()

    for q, sector, company, reason in queries:
        print(f"  Query: {q[:60]}")
        articles = fetch_gnews(q, max_items=args.max_per_query)
        time.sleep(0.8)  # polite pause between Google RSS requests
        for art in articles:
            url = art.get("source_url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            art["matched_sector"]  = sector
            art["matched_company"] = company
            art["match_reason"]    = reason
            all_items.append(art)

    print(f"  Unique articles found: {len(all_items)}")

    # 4. Save to DB (or print for --dry-run)
    written = upsert_items(sb, all_items, dry_run=args.dry_run)
    if sb:
        deactivate_old(sb, days=7)

    print(f"Done. {written} articles {'would be ' if args.dry_run else ''}saved/updated.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
