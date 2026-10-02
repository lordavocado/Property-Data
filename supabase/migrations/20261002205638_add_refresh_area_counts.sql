/*
# Add refresh_area_counts function

1. Purpose
- Keeps `dim_areas.listing_count` current after each scrape. Called by the
  scraper at the end of a run.

2. New Function
- `refresh_area_counts()` — security definer, locked search_path, recalculates
  listing_count per area from properties. Executable by anon/authenticated
  (scraper uses privileged key anyway; safe because it only updates counts).
*/

CREATE OR REPLACE FUNCTION refresh_area_counts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO dim_areas (search_area_norm, display_label, state, listing_count, updated_at)
  SELECT lower(p.search_area), min(p.search_area), max(p.state), count(*), now()
  FROM properties p
  WHERE p.search_area IS NOT NULL
  GROUP BY lower(p.search_area)
  ON CONFLICT (search_area_norm) DO UPDATE
    SET listing_count = EXCLUDED.listing_count,
        state = EXCLUDED.state,
        updated_at = now();
$$;

GRANT EXECUTE ON FUNCTION refresh_area_counts() TO anon, authenticated;
