/*
# Taxonomy & scale foundation for properties

1. Purpose
- Standardizes the vocabulary of listing data (ontology): every status, property
  type, and data source comes from a controlled list instead of free text.
- Adds a scrape-batch entity so every row is traceable to the exact run that
  produced it (provenance).
- Adds the indexes the UI and scraper need so the flat table stays fast at
  hundreds of thousands of rows.

2. New Types (enums)
- `listing_status`: FOR_SALE, PENDING, CONTINGENT, SOLD, OFF_MARKET, UNKNOWN
- `property_type`: SINGLE_FAMILY, CONDO, TOWNHOME, MULTI_FAMILY, MOBILE, LAND, APARTMENT, OTHER

3. New Tables
- `scrape_batches`: one row per scraper run (provenance): id, source, started_at,
  finished_at, listing_type, locations, row_count, status, error.
- `dim_areas`: distinct normalized search areas with display label, state, listing counts.
- `dim_property_types`: enum value + human label + sort order for UI filters.

4. Modified Tables
- `properties`:
  - add `listing_status` (enum copy of status, backfilled)
  - add `property_type` (enum copy of normalized style, backfilled)
  - add `batch_id` (nullable FK to scrape_batches; NULL = legacy import)
  - add generated columns `search_area_norm`, `price_bucket`, `geo_point`
  - backfill source from NULL -> 'Realtor.com'

5. Security
- All new tables get RLS enabled with anon+authenticated read policies
  (single-tenant app, data intentionally public to the app).
- No write policies: only the privileged scraper writes.

6. Indexes
- Enum, area, date, batch, city/state, status+price composite, GIST on geo_point.
*/

-- ---------- Enums ----------
DO $$ BEGIN
  CREATE TYPE listing_status AS ENUM ('FOR_SALE','PENDING','CONTINGENT','SOLD','OFF_MARKET','UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE property_type AS ENUM ('SINGLE_FAMILY','CONDO','TOWNHOME','MULTI_FAMILY','MOBILE','LAND','APARTMENT','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Scrape batches (provenance) ----------
CREATE TABLE IF NOT EXISTS scrape_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'Realtor.com',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  listing_type text,
  locations text[],
  row_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  error text
);

ALTER TABLE scrape_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_scrape_batches" ON scrape_batches;
CREATE POLICY "read_scrape_batches" ON scrape_batches FOR SELECT
TO anon, authenticated USING (true);

-- ---------- Normalized columns on properties ----------
ALTER TABLE properties ADD COLUMN IF NOT EXISTS listing_status listing_status;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_type property_type;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES scrape_batches(id);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS search_area_norm text
  GENERATED ALWAYS AS (lower(search_area)) STORED;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS price_bucket text
  GENERATED ALWAYS AS (
    CASE
      WHEN list_price IS NULL THEN NULL
      WHEN list_price < 200000 THEN '<200k'
      WHEN list_price < 400000 THEN '200-400k'
      WHEN list_price < 600000 THEN '400-600k'
      WHEN list_price < 800000 THEN '600-800k'
      WHEN list_price < 1000000 THEN '800k-1m'
      WHEN list_price < 2000000 THEN '1-2m'
      ELSE '2m+'
    END
  ) STORED;

-- ---------- Backfill taxonomy ----------
UPDATE properties SET listing_status =
  CASE status
    WHEN 'FOR_SALE' THEN 'FOR_SALE'::listing_status
    WHEN 'PENDING' THEN 'PENDING'::listing_status
    WHEN 'CONTINGENT' THEN 'CONTINGENT'::listing_status
    WHEN 'SOLD' THEN 'SOLD'::listing_status
    ELSE 'UNKNOWN'::listing_status
  END
WHERE listing_status IS NULL;

UPDATE properties SET property_type =
  CASE style
    WHEN 'SINGLE_FAMILY' THEN 'SINGLE_FAMILY'::property_type
    WHEN 'CONDOS' THEN 'CONDO'::property_type
    WHEN 'CONDO' THEN 'CONDO'::property_type
    WHEN 'CONDO_TOWNHOME_ROWHOME_COOP' THEN 'CONDO'::property_type
    WHEN 'TOWNHOMES' THEN 'TOWNHOME'::property_type
    WHEN 'TOWNHOME' THEN 'TOWNHOME'::property_type
    WHEN 'MULTI_FAMILY' THEN 'MULTI_FAMILY'::property_type
    WHEN 'MOBILE' THEN 'MOBILE'::property_type
    WHEN 'LAND' THEN 'LAND'::property_type
    WHEN 'APARTMENT' THEN 'APARTMENT'::property_type
    ELSE 'OTHER'::property_type
  END
WHERE property_type IS NULL;

UPDATE properties SET source = 'Realtor.com' WHERE source IS NULL;

-- ---------- Geo point ----------
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS geo_point geography(Point, 4326)
  GENERATED ALWAYS AS (
    CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
    END
  ) STORED;

-- ---------- Dimension tables ----------
CREATE TABLE IF NOT EXISTS dim_areas (
  search_area_norm text PRIMARY KEY,
  display_label text NOT NULL,
  state text,
  listing_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dim_property_types (
  value property_type PRIMARY KEY,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

ALTER TABLE dim_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_property_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_dim_areas" ON dim_areas;
CREATE POLICY "read_dim_areas" ON dim_areas FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "read_dim_property_types" ON dim_property_types;
CREATE POLICY "read_dim_property_types" ON dim_property_types FOR SELECT TO anon, authenticated USING (true);

INSERT INTO dim_property_types (value, label, sort_order) VALUES
  ('SINGLE_FAMILY', 'Single Family', 1),
  ('CONDO', 'Condo', 2),
  ('TOWNHOME', 'Townhome', 3),
  ('MULTI_FAMILY', 'Multi Family', 4),
  ('MOBILE', 'Mobile', 5),
  ('LAND', 'Land', 6),
  ('APARTMENT', 'Apartment', 7),
  ('OTHER', 'Other', 8)
ON CONFLICT (value) DO NOTHING;

INSERT INTO dim_areas (search_area_norm, display_label, state, listing_count)
SELECT lower(search_area), min(search_area), max(state), count(*)
FROM properties WHERE search_area IS NOT NULL
GROUP BY lower(search_area)
ON CONFLICT (search_area_norm) DO UPDATE
  SET listing_count = EXCLUDED.listing_count, updated_at = now();

-- ---------- Indexes ----------
CREATE INDEX IF NOT EXISTS idx_properties_listing_status ON properties (listing_status);
CREATE INDEX IF NOT EXISTS idx_properties_property_type ON properties (property_type);
CREATE INDEX IF NOT EXISTS idx_properties_search_area_norm ON properties (search_area_norm);
CREATE INDEX IF NOT EXISTS idx_properties_list_date ON properties (list_date DESC);
CREATE INDEX IF NOT EXISTS idx_properties_batch_id ON properties (batch_id);
CREATE INDEX IF NOT EXISTS idx_properties_city_state ON properties (city, state);
CREATE INDEX IF NOT EXISTS idx_properties_status_price ON properties (listing_status, list_price);
CREATE INDEX IF NOT EXISTS idx_properties_geo ON properties USING GIST (geo_point);
