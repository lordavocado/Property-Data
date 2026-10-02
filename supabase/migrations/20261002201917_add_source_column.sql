-- Add source column tracking where the listing data came from
ALTER TABLE properties ADD COLUMN IF NOT EXISTS source text;

-- Backfill existing rows: this dataset was scraped from Realtor.com via HomeHarvest
UPDATE properties SET source = 'Realtor.com' WHERE source IS NULL;

-- Index for filtering by source
CREATE INDEX IF NOT EXISTS idx_properties_source ON properties (source);
