-- Track which search region each listing was scraped under
ALTER TABLE properties ADD COLUMN IF NOT EXISTS search_area text;

-- Backfill by state: each scrape location corresponds to one state in this dataset
UPDATE properties SET search_area = 'San Diego, CA' WHERE state = 'CA' AND search_area IS NULL;
UPDATE properties SET search_area = 'Austin, TX' WHERE state = 'TX' AND search_area IS NULL;
UPDATE properties SET search_area = 'Miami, FL' WHERE state = 'FL' AND search_area IS NULL;

CREATE INDEX IF NOT EXISTS idx_properties_search_area ON properties (search_area);
