"""
One-time data fix: re-apply sector classification to all companies.

The original SECTOR_MAP used "Banks" (plural) which never matched NSE's
"Private Sector Bank" / "Public Sector Bank" industry labels (singular).
This caused ~183 companies — including all banks — to fall into "Other".

This script re-runs pick_sector() against each company's industry field
and updates the sector column where it changed.

Run:
    py scripts/fix_sectors.py --dry-run   # preview what will change
    py scripts/fix_sectors.py --apply     # write to DB
"""

from __future__ import annotations

import argparse
import os
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

from supabase import create_client
from seed_universe import pick_sector

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Write changes to DB (default: dry run)")
    ap.add_argument("--diagnose", action="store_true", help="Show industry labels still mapping to Other after fix")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Fetch all active companies with their current sector and industry.
    print("Fetching companies...")
    page, all_rows = 0, []
    while True:
        resp = sb.table("companies") \
            .select("id,ticker,industry,sector") \
            .eq("is_active", True) \
            .range(page * 1000, (page + 1) * 1000 - 1) \
            .execute()
        rows = resp.data or []
        all_rows.extend(rows)
        if len(rows) < 1000:
            break
        page += 1
    print(f"  {len(all_rows)} active companies")

    changes: list[dict] = []
    sector_counts: dict[str, int] = {}
    other_industries: dict[str, int] = {}
    for row in all_rows:
        new_sector = pick_sector(row.get("industry"))
        old_sector = row.get("sector") or "Other"
        sector_counts[new_sector] = sector_counts.get(new_sector, 0) + 1
        if new_sector == "Other":
            ind = row.get("industry") or "(blank)"
            other_industries[ind] = other_industries.get(ind, 0) + 1
        if new_sector != old_sector:
            changes.append({
                "id":        row["id"],
                "ticker":    row["ticker"],
                "industry":  row.get("industry"),
                "old_sector": old_sector,
                "new_sector": new_sector,
            })

    print(f"\nSector distribution after fix:")
    for s, n in sorted(sector_counts.items(), key=lambda x: -x[1]):
        print(f"  {s:<35} {n}")

    if args.diagnose:
        print(f"\nIndustry labels still mapping to 'Other' ({sum(other_industries.values())} companies):")
        for ind, n in sorted(other_industries.items(), key=lambda x: -x[1]):
            print(f"  {n:4}  {ind}")

    print(f"\n{len(changes)} companies need sector update:")
    # Show top changes
    for c in changes[:30]:
        print(f"  {c['ticker']:<24} {c['old_sector']:<20} -> {c['new_sector']}  (industry: {c['industry']})")
    if len(changes) > 30:
        print(f"  ... and {len(changes) - 30} more")

    if not args.apply:
        print("\n(Dry run. Add --apply to write.)")
        return 0

    # Apply in batches of 200.
    updated = 0
    for i in range(0, len(changes), 200):
        chunk = changes[i:i+200]
        for c in chunk:
            sb.table("companies").update({"sector": c["new_sector"]}).eq("id", c["id"]).execute()
            updated += 1
        print(f"  Updated {updated}/{len(changes)}...")

    print(f"Done. {updated} companies re-classified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
