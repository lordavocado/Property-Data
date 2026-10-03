/*
# Properties-with-tags view for the UI

1. Purpose
- One query for the listings table: every property row plus its aggregated
  tag values (array) and tag labels. Lets the UI filter with a single
  "contains" filter and render chips without extra requests.

2. New View
- `properties_with_tags` (security_invoker = true so RLS still applies):
  all properties_enriched columns plus
  - `tag_values` text[] — machine tag values, e.g. ['pool','luxury']
  - `tag_labels` text[] — display labels, e.g. ['Pool','Luxury']

3. Security
- security_invoker = true: underlying table policies apply unchanged; all
  data is already anon-readable.
*/

CREATE OR REPLACE VIEW properties_with_tags
WITH (security_invoker = true) AS
SELECT
  p.*,
  COALESCE(
    (SELECT ARRAY_AGG(DISTINCT t.value) FROM property_tags pt
     JOIN tags t ON t.id = pt.tag_id
     WHERE pt.property_id = p.property_id),
    ARRAY[]::text[]
  ) AS tag_values,
  COALESCE(
    (SELECT ARRAY_AGG(DISTINCT t.label) FROM property_tags pt
     JOIN tags t ON t.id = pt.tag_id
     WHERE pt.property_id = p.property_id),
    ARRAY[]::text[]
  ) AS tag_labels
FROM properties_enriched p;
