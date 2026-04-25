"""
fetch_expert_quotes.py — Part 6 of the Corporate Earnings Dashboard upgrade.

Seeds and refreshes the `expert_quotes` table with curated management /
analyst commentary from public sources.

The script works in two modes:

1.  --seed   : Insert a starter set of recent management quotes (hardcoded
               list, so the block is populated on first deploy). Editors
               should replace/extend via the Supabase dashboard.

2.  --deactivate-old DAYS : Mark quotes older than N days as is_active=false
               so stale commentary doesn't surface. Default: 90 days.

Rules (from spec):
  - No paid content scraping.
  - Every quote MUST include: expert_name, designation, firm, quote,
    source_name, published_date.
  - Quotes ≤ 40 words.
  - Verified quotes only (earnings calls, investor presentations, press
    releases, public news articles with a URL).

Run:
    py scripts/fetch_expert_quotes.py --seed
    py scripts/fetch_expert_quotes.py --deactivate-old 90
    py scripts/fetch_expert_quotes.py --seed --deactivate-old 90
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime, timedelta, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")


def sb_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# -----------------------------------------------------------------------
# Starter seed quotes
#
# IMPORTANT: Every quote MUST have a source_url pointing to the specific
# article, press release, or earnings-call transcript that the quote
# came from — NOT a generic investor-relations homepage.
#
# The SEED_QUOTES list below is intentionally empty after the initial
# placeholder quotes were deactivated (they used homepage URLs, not
# specific article links). Add real quotes via:
#
#   1. The Supabase Table Editor (expert_quotes → Insert row).
#   2. Extend this SEED_QUOTES list with verified, specific URLs and
#      re-run: py scripts/fetch_expert_quotes.py --seed
#
# Required fields for every quote:
#   expert_name, designation, firm, quote (≤40 words),
#   source_url (specific article/transcript link),
#   source_name, published_date, is_active=True
# -----------------------------------------------------------------------

SEED_QUOTES: list[dict] = [
    # Add verified quotes with specific article URLs here.
    # Example structure:
    # {
    #     "expert_name":    "CEO Name",
    #     "designation":    "CEO & MD",
    #     "firm":           "Company Name",
    #     "quote":          "Exact verbatim quote from the source, max 40 words.",
    #     "source_name":    "Company Q4 FY26 Earnings Call Transcript",
    #     "source_url":     "https://example.com/specific-transcript-page",
    #     "published_date": "2026-04-25",
    #     "ticker":         "TICKER.NS",
    #     "quarter":        "Q4 FY26",
    # },
]


def seed_quotes(sb: Client) -> None:
    """Insert starter quotes. Skip if an identical (expert_name, quarter) exists."""
    inserted = 0
    for q in SEED_QUOTES:
        # Truncate quote to ≤ 40 words
        words = q["quote"].split()
        if len(words) > 40:
            q["quote"] = " ".join(words[:40]) + "…"

        try:
            # Check for existing row
            existing = (
                sb.from_("expert_quotes")
                .select("id")
                .eq("expert_name", q["expert_name"])
                .eq("quarter", q.get("quarter") or "")
                .limit(1)
                .execute()
            )
            if existing.data:
                print(f"  — already exists: {q['expert_name']} / {q.get('quarter')}")
                continue

            sb.from_("expert_quotes").insert({**q, "is_active": True}).execute()
            inserted += 1
            print(f"  ✓ inserted: {q['expert_name']} ({q.get('firm')})")
        except Exception as exc:
            print(f"  ✗ {q['expert_name']}: {exc}", file=sys.stderr)

    print(f"\nSeed done. {inserted} quotes inserted.")


def deactivate_old(sb: Client, days: int) -> None:
    """Mark quotes older than `days` as is_active=false."""
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    try:
        resp = (
            sb.from_("expert_quotes")
            .update({"is_active": False})
            .lt("published_date", cutoff)
            .eq("is_active", True)
            .execute()
        )
        count = len(resp.data or [])
        print(f"Deactivated {count} quotes older than {days} days (before {cutoff}).")
    except Exception as exc:
        print(f"Deactivate failed: {exc}", file=sys.stderr)


def run(args: argparse.Namespace) -> None:
    sb = sb_client()

    if args.seed:
        print("Seeding starter expert quotes…")
        seed_quotes(sb)

    if args.deactivate_old is not None:
        print(f"\nDeactivating quotes older than {args.deactivate_old} days…")
        deactivate_old(sb, args.deactivate_old)

    if not args.seed and args.deactivate_old is None:
        print(
            "Nothing to do. Use --seed to insert starter quotes "
            "or --deactivate-old DAYS to age them out."
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Seed and maintain the expert_quotes table."
    )
    parser.add_argument(
        "--seed",
        action="store_true",
        help="Insert the starter set of curated management quotes.",
    )
    parser.add_argument(
        "--deactivate-old",
        type=int,
        metavar="DAYS",
        dest="deactivate_old",
        default=None,
        help="Deactivate (is_active=false) quotes older than DAYS days.",
    )
    args = parser.parse_args()
    run(args)
