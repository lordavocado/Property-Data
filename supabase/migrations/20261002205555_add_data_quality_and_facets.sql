/*
# Data quality scoring and aggregate stats

1. Purpose
- Makes data value measurable: every property gets a `data_quality_score`
  (0-100) based on how many valuable fields are populated (price, beds/baths,
  sqft, photos, description, agent, geo, dates).
- Provides a security-definer RPC `get_filter_facets` returning per-filter counts
  (by status, type, price bucket) in one round trip for the UI.
- Properties view `properties_enriched` exposing the score alongside the row.

2. New Function
- `get_filter_facets()` — security definer, returns JSON with counts grouped by
  listing_status, property_type, price_bucket. Callable by anon/authenticated.
  Definer + fixed search_path so RLS on properties (read policy) is not bypassed
  beyond intended public reads.

3. New View
- `properties_enriched` (security_invoker = true, so RLS still applies): all
  properties columns plus data_quality_score.

4. Security
- Function is SECURITY DEFINER with locked search_path, EXECUTE granted to
  anon, authenticated. It only aggregates, returns no sensitive data.
- View runs with invoker rights; underlying table policies apply.
*/

CREATE OR REPLACE FUNCTION get_filter_facets()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'by_status', (
      SELECT coalesce(json_object_agg(t.listing_status, t.n), '{}'::json)
      FROM (
        SELECT listing_status, count(*) AS n
        FROM properties GROUP BY listing_status
      ) t
    ),
    'by_type', (
      SELECT coalesce(json_object_agg(t.property_type, t.n), '{}'::json)
      FROM (
        SELECT property_type, count(*) AS n
        FROM properties GROUP BY property_type
      ) t
    ),
    'by_price_bucket', (
      SELECT coalesce(json_object_agg(t.price_bucket, t.n), '{}'::json)
      FROM (
        SELECT price_bucket, count(*) AS n
        FROM properties WHERE price_bucket IS NOT NULL GROUP BY price_bucket
      ) t
    )
  );
$$;

GRANT EXECUTE ON FUNCTION get_filter_facets() TO anon, authenticated;

CREATE OR REPLACE VIEW properties_enriched
WITH (security_invoker = true) AS
SELECT
  p.*,
  (
    (CASE WHEN list_price IS NOT NULL THEN 20 ELSE 0 END) +
    (CASE WHEN beds IS NOT NULL THEN 10 ELSE 0 END) +
    (CASE WHEN full_baths IS NOT NULL OR half_baths IS NOT NULL THEN 10 ELSE 0 END) +
    (CASE WHEN sqft IS NOT NULL THEN 15 ELSE 0 END) +
    (CASE WHEN primary_photo IS NOT NULL THEN 10 ELSE 0 END) +
    (CASE WHEN description_text IS NOT NULL THEN 10 ELSE 0 END) +
    (CASE WHEN agent_name IS NOT NULL THEN 5 ELSE 0 END) +
    (CASE WHEN latitude IS NOT NULL THEN 10 ELSE 0 END) +
    (CASE WHEN list_date IS NOT NULL THEN 5 ELSE 0 END) +
    (CASE WHEN year_built IS NOT NULL THEN 5 ELSE 0 END)
  ) AS data_quality_score
FROM properties p;
