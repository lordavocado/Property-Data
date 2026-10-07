"""
Backfill missing description_text for existing properties in Supabase.

The original dataset was inserted via SQL migrations that omitted descriptions.
This script re-scrapes each property individually from Realtor.com and updates
only the description_text column, leaving every other field untouched.

Usage: python3 backfill_descriptions.py
"""

import os
import sys
import time

from supabase import create_client

from homeharvest.core.scrapers import ScraperInput, ReturnType, ListingType
from homeharvest.core.scrapers.realtor import RealtorScraper


def get_client():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables.")
    return create_client(url, key)


def main():
    sb = get_client()
    resp = (
        sb.table("properties")
        .select("property_id, primary_photo")
        .or_("description_text.is.null,description_text.eq.'',primary_photo.is.null")
        .execute()
    )
    rows = resp.data or []
    print(f"Properties missing descriptions: {len(rows)}")
    if not rows:
        print("Nothing to backfill.")
        return

    scraper = RealtorScraper(
        ScraperInput(
            location="",
            listing_type=ListingType.FOR_SALE,
            return_type=ReturnType.pandas,
        )
    )
    updated = 0
    failed = 0
    for i, row in enumerate(rows, 1):
        pid = row["property_id"]
        try:
            results = scraper.handle_home(pid)
            text = None
            photo = None
            if results:
                d = getattr(results[0], "description", None)
                text = getattr(d, "text", None)
                photo = str(getattr(d, "primary_photo", None) or "") or None
            patch = {}
            if text:
                patch["description_text"] = text
            if photo and not row.get("primary_photo"):
                patch["primary_photo"] = photo
            if patch:
                sb.table("properties").update(patch).eq("property_id", pid).execute()
                updated += 1
                what = "description" if text else ""
                if photo and not row.get("primary_photo"):
                    what = (what + " +photo").strip(" +")
                print(f"  [{i}/{len(rows)}] {pid}: updated ({what or 'nothing new'})")
            else:
                failed += 1
                print(f"  [{i}/{len(rows)}] {pid}: no data returned")
        except Exception as e:
            failed += 1
            print(f"  [{i}/{len(rows)}] {pid}: ERROR {e}")
        time.sleep(0.5)

    print(f"\nDone. Updated {updated}, failed {failed} of {len(rows)}.")


if __name__ == "__main__":
    main()
