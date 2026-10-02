/*
# Create properties table for HomeHarvest scraped real estate data

1. Purpose
   - Stores real estate property listings scraped from Realtor.com via the HomeHarvest library.
   - Each row represents a single property listing with full MLS-style details.

2. New Tables
   - `properties`
     - `id` (uuid, primary key, auto-generated)
     - `property_id` (text, unique identifier from Realtor.com)
     - `listing_id` (text, listing identifier)
     - `permalink` (text, permanent link slug)
     - `mls` (text, MLS system name)
     - `mls_id` (text, MLS listing number)
     - `status` (text, listing status: for_sale, for_rent, sold, pending, etc.)
     - `mls_status` (text, raw MLS status)
     - `style` (text, property style/type)
     - `street` (text, street address)
     - `unit` (text, unit number)
     - `city` (text, city name)
     - `state` (text, state abbreviation)
     - `zip_code` (text, ZIP code)
     - `county` (text, county name)
     - `formatted_address` (text, full formatted address)
     - `beds` (integer, number of bedrooms)
     - `full_baths` (integer, number of full bathrooms)
     - `half_baths` (integer, number of half bathrooms)
     - `sqft` (integer, square footage)
     - `lot_sqft` (integer, lot square footage)
     - `year_built` (integer, year property was built)
     - `days_on_mls` (integer, days listed on MLS)
     - `list_price` (integer, current listing price)
     - `list_price_min` (integer, minimum price range)
     - `list_price_max` (integer, maximum price range)
     - `list_date` (timestamptz, date listed)
     - `pending_date` (timestamptz, date went pending)
     - `sold_price` (integer, final sold price)
     - `last_sold_date` (timestamptz, date last sold)
     - `last_sold_price` (integer, previous sold price)
     - `last_status_change_date` (timestamptz, last status change)
     - `last_update_date` (timestamptz, last update)
     - `price_per_sqft` (integer, price per square foot)
     - `assessed_value` (integer, tax assessed value)
     - `estimated_value` (integer, estimated market value)
     - `new_construction` (boolean, is new construction)
     - `hoa_fee` (integer, HOA fee)
     - `stories` (integer, number of stories)
     - `parking_garage` (float, garage spaces)
     - `latitude` (float, geographic latitude)
     - `longitude` (float, geographic longitude)
     - `neighborhoods` (text, neighborhood names)
     - `fips_code` (text, FIPS county code)
     - `property_url` (text, URL to listing on Realtor.com)
     - `primary_photo` (text, URL to primary photo)
     - `agent_name` (text, listing agent name)
     - `agent_email` (text, listing agent email)
     - `broker_name` (text, broker name)
     - `office_name` (text, office name)
     - `description_text` (text, full property description)
     - `scraped_at` (timestamptz, when this row was scraped)
     - `created_at` (timestamptz, row creation timestamp)

3. Security
   - Enable RLS on `properties`.
   - This is a single-tenant app with no sign-in screen, so policies allow anon + authenticated CRUD.
   - `USING (true)` / `WITH CHECK (true)` is intentional because the data is publicly shared.

4. Indexes
   - Unique index on `property_id` to prevent duplicate listings.
   - Index on `status` for filtering by listing type.
   - Index on `city, state` for location-based queries.
   - Index on `list_price` for price range queries.
   - Index on `list_date` for date-based queries.
*/

CREATE TABLE IF NOT EXISTS properties (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id text UNIQUE,
    listing_id text,
    permalink text,
    mls text,
    mls_id text,
    status text,
    mls_status text,
    style text,
    street text,
    unit text,
    city text,
    state text,
    zip_code text,
    county text,
    formatted_address text,
    beds integer,
    full_baths integer,
    half_baths integer,
    sqft integer,
    lot_sqft integer,
    year_built integer,
    days_on_mls integer,
    list_price integer,
    list_price_min integer,
    list_price_max integer,
    list_date timestamptz,
    pending_date timestamptz,
    sold_price integer,
    last_sold_date timestamptz,
    last_sold_price integer,
    last_status_change_date timestamptz,
    last_update_date timestamptz,
    price_per_sqft integer,
    assessed_value integer,
    estimated_value integer,
    new_construction boolean,
    hoa_fee integer,
    stories integer,
    parking_garage float,
    latitude float,
    longitude float,
    neighborhoods text,
    fips_code text,
    property_url text,
    primary_photo text,
    agent_name text,
    agent_email text,
    broker_name text,
    office_name text,
    description_text text,
    scraped_at timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now()
);

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_properties" ON properties;
CREATE POLICY "anon_select_properties" ON properties FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_properties" ON properties;
CREATE POLICY "anon_insert_properties" ON properties FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_properties" ON properties;
CREATE POLICY "anon_update_properties" ON properties FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_properties" ON properties;
CREATE POLICY "anon_delete_properties" ON properties FOR DELETE
TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_properties_property_id ON properties (property_id);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties (status);
CREATE INDEX IF NOT EXISTS idx_properties_city_state ON properties (city, state);
CREATE INDEX IF NOT EXISTS idx_properties_list_price ON properties (list_price);
CREATE INDEX IF NOT EXISTS idx_properties_list_date ON properties (list_date);
