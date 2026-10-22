"""
Scrape property listings from Realtor.com using HomeHarvest and store them
via the project's ingest API (backed by MongoDB).

This script:
1. Scrapes property listings for specified locations and listing types
2. Sends the results to the server's /api/ingest/properties endpoint
3. Upserts on property_id so re-running won't create duplicates

Usage: python3 scrape_to_supabase.py
"""

import os
import sys
import math
import time
import requests
from datetime import datetime, timezone

from homeharvest import scrape_property

API_URL = os.environ.get("API_URL", "http://localhost:3001/api")
INGEST_SECRET = os.environ.get("INGEST_SECRET")


def headers():
    h = {"Content-Type": "application/json"}
    if INGEST_SECRET:
        h["x-ingest-secret"] = INGEST_SECRET
    return h


STATUS_MAP = {
    "FOR_SALE": "FOR_SALE", "PENDING": "PENDING", "CONTINGENT": "CONTINGENT",
    "SOLD": "SOLD", "OFF_MARKET": "OFF_MARKET", "OTHER": "UNKNOWN",
}

STYLE_MAP = {
    "SINGLE_FAMILY": "SINGLE_FAMILY", "CONDO": "CONDO", "CONDOS": "CONDO",
    "CONDO_TOWNHOME_ROWHOME_COOP": "CONDO", "TOWNHOME": "TOWNHOME",
    "TOWNHOMES": "TOWNHOME", "MULTI_FAMILY": "MULTI_FAMILY", "MOBILE": "MOBILE",
    "LAND": "LAND", "APARTMENT": "APARTMENT",
}


def dataframe_to_records(df, search_area: str, batch_id: str | None = None) -> list[dict]:
    """Convert a pandas DataFrame to a list of dicts for the ingest API."""
    records = []
    now = datetime.now(timezone.utc).isoformat()

    for _, row in df.iterrows():
        def val(col):
            v = row.get(col)
            if v is None:
                return None
            try:
                if isinstance(v, float) and math.isnan(v):
                    return None
            except (TypeError, ValueError):
                pass
            try:
                if pd.isna(v):
                    return None
            except (TypeError, ValueError):
                pass
            return v

        record = {
            "property_id": val("property_id"),
            "listing_id": val("listing_id"),
            "permalink": val("permalink"),
            "mls": val("mls"),
            "source": "Realtor.com",
            "mls_id": val("mls_id"),
            "status": val("status"),
            "listing_status": STATUS_MAP.get((val("status") or "OTHER").upper(), "UNKNOWN"),
            "mls_status": val("mls_status"),
            "style": val("style"),
            "property_type": STYLE_MAP.get((val("style") or "OTHER").upper(), "OTHER"),
            "street": val("street"),
            "unit": val("unit"),
            "city": val("city"),
            "state": val("state"),
            "zip_code": val("zip_code"),
            "county": val("county"),
            "formatted_address": val("formatted_address"),
            "beds": val("beds"),
            "full_baths": val("full_baths"),
            "half_baths": val("half_baths"),
            "sqft": val("sqft"),
            "lot_sqft": val("lot_sqft"),
            "year_built": val("year_built"),
            "days_on_mls": val("days_on_mls"),
            "list_price": val("list_price"),
            "list_price_min": val("list_price_min"),
            "list_price_max": val("list_price_max"),
            "list_date": str(val("list_date")) if val("list_date") else None,
            "pending_date": str(val("pending_date")) if val("pending_date") else None,
            "sold_price": val("sold_price"),
            "last_sold_date": str(val("last_sold_date")) if val("last_sold_date") else None,
            "last_sold_price": val("last_sold_price"),
            "last_status_change_date": str(val("last_status_change_date")) if val("last_status_change_date") else None,
            "last_update_date": str(val("last_update_date")) if val("last_update_date") else None,
            "price_per_sqft": val("price_per_sqft"),
            "assessed_value": val("assessed_value"),
            "estimated_value": val("estimated_value"),
            "new_construction": bool(val("new_construction")) if val("new_construction") is not None else False,
            "hoa_fee": val("hoa_fee"),
            "stories": val("stories"),
            "parking_garage": val("parking_garage"),
            "latitude": val("latitude"),
            "longitude": val("longitude"),
            "neighborhoods": val("neighborhoods"),
            "fips_code": val("fips_code"),
            "property_url": str(val("property_url")) if val("property_url") else None,
            "primary_photo": str(val("primary_photo")) if val("primary_photo") else None,
            "agent_name": val("agent_name"),
            "agent_email": val("agent_email"),
            "broker_name": val("broker_name"),
            "office_name": val("office_name"),
            "description_text": val("text"),
            "search_area": search_area,
            "batch_id": batch_id,
            "scraped_at": now,
        }

        records.append(record)

    return records


import pandas as pd  # noqa: E402  (used in val() above)


def main():
    locations = [
        "San Diego, CA",
        "Austin, TX",
        "Miami, FL",
    ]

    listing_types = ["for_sale"]

    print("=" * 60)
    print("HomeHarvest -> API Property Scraper (MongoDB backend)")
    print("=" * 60)

    # Health check
    health = requests.get(f"{API_URL}/health", headers=headers(), timeout=10)
    health.raise_for_status()

    batch_resp = requests.post(
        f"{API_URL}/ingest/scrape-batch",
        headers=headers(),
        json={
            "source": "Realtor.com",
            "listingType": ",".join(listing_types),
            "locations": locations,
        },
        timeout=30,
    )
    batch_resp.raise_for_status()
    batch_id = batch_resp.json()["batchId"]
    print(f"Scrape batch: {batch_id}")

    scrape_errors = []
    total_records = 0
    for location in locations:
        for lt in listing_types:
            print(f"\nScraping: {location} | listing_type={lt} | past_days=30")
            try:
                df = scrape_property(
                    location=location,
                    listing_type=lt,
                    past_days=30,
                    limit=50,
                )
            except Exception as e:
                print(f"  ERROR scraping {location}/{lt}: {e}")
                scrape_errors.append(f"{location}/{lt}: {e}")
                continue

            if df.empty:
                print(f"  No properties found for {location}/{lt}")
                continue

            print(f"  Scraped {len(df)} properties")
            records = dataframe_to_records(df, search_area=location, batch_id=batch_id)
            total_records += len(records)

            # Upload in batches of 50
            batch_size = 50
            for i in range(0, len(records), batch_size):
                chunk = records[i : i + batch_size]
                try:
                    resp = requests.post(
                        f"{API_URL}/ingest/properties",
                        headers=headers(),
                        json={"records": chunk},
                        timeout=60,
                    )
                    resp.raise_for_status()
                    print(f"  Uploaded batch {i // batch_size + 1}: {len(chunk)} rows")
                except Exception as e:
                    print(f"  ERROR uploading batch {i // batch_size + 1}: {e}")
                    scrape_errors.append(f"upload {i // batch_size + 1}: {e}")
                time.sleep(0.2)

    finish = requests.post(
        f"{API_URL}/ingest/scrape-batch/{batch_id}/finish",
        headers=headers(),
        json={
            "rowCount": total_records,
            "status": "completed" if not scrape_errors else "failed",
            "error": "\n".join(scrape_errors) if scrape_errors else None,
        },
        timeout=30,
    )
    finish.raise_for_status()

    print(f"\n{'=' * 60}")
    print(f"Done! Sent {total_records} properties to the API.")
    print("=" * 60)


if __name__ == "__main__":
    main()
