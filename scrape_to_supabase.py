"""
Scrape property listings from Realtor.com using HomeHarvest and store them in Supabase.

This script:
1. Scrapes property listings for specified locations and listing types
2. Uploads the results to a Supabase `properties` table
3. Upserts on property_id so re-running won't create duplicates
"""

import os
import sys
import math
import pandas as pd
from datetime import datetime, timezone

from supabase import create_client, Client
from homeharvest import scrape_property


def get_supabase_client() -> Client:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables.")
    return create_client(url, key)


def dataframe_to_records(df) -> list[dict]:
    """Convert a pandas DataFrame to a list of dicts matching the properties table schema."""
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
            "mls_id": val("mls_id"),
            "status": val("status"),
            "mls_status": val("mls_status"),
            "style": val("style"),
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
            "new_construction": val("new_construction"),
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
            "scraped_at": now,
        }

        records.append(record)

    return records


def records_to_sql(records: list[dict]) -> str:
    """Convert records to a single SQL string with batch INSERT ... ON CONFLICT upsert."""
    if not records:
        return ""

    # Use a fixed column order from the first record
    cols = list(records[0].keys())
    col_str = ", ".join(cols)
    update_str = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != "property_id")

    value_rows = []
    for record in records:
        vals = []
        for col in cols:
            val = record.get(col)
            if val is None:
                vals.append("NULL")
            elif isinstance(val, bool):
                vals.append("TRUE" if val else "FALSE")
            elif isinstance(val, (int, float)):
                vals.append(str(val))
            else:
                escaped = str(val).replace("'", "''")
                vals.append(f"'{escaped}'")
        value_rows.append(f"({', '.join(vals)})")

    return (
        f"INSERT INTO properties ({col_str}) VALUES "
        + ", ".join(value_rows)
        + f" ON CONFLICT (property_id) DO UPDATE SET {update_str};"
    )


def main():
    locations = [
        "San Diego, CA",
        "Austin, TX",
        "Miami, FL",
    ]

    listing_types = ["for_sale"]

    print("=" * 60)
    print("HomeHarvest -> Supabase Property Scraper")
    print("=" * 60)

    all_records = []
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
                continue

            if df.empty:
                print(f"  No properties found for {location}/{lt}")
                continue

            print(f"  Scraped {len(df)} properties")
            records = dataframe_to_records(df)
            all_records.extend(records)

    print(f"\nTotal scraped: {len(all_records)} properties")

    # Write SQL in batches of 5 to separate files for execute_sql
    batch_size = 5
    for i in range(0, len(all_records), batch_size):
        batch = all_records[i : i + batch_size]
        sql = records_to_sql(batch)
        batch_num = i // batch_size + 1
        sql_file = f"/tmp/cc-agent/71669975/project/batch_{batch_num}.sql"
        with open(sql_file, "w") as f:
            f.write(sql)
        print(f"  Wrote batch {batch_num}: {len(batch)} rows -> {sql_file}")

    print(f"\n{'=' * 60}")
    print(f"Done! {len(all_records)} properties across {math.ceil(len(all_records) / batch_size)} batch files.")
    print("=" * 60)


if __name__ == "__main__":
    main()
