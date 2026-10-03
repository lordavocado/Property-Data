/*
# Tag taxonomy and listing taggings

1. Purpose
- Adds an AI-tagging layer: every listing can carry tags from a controlled
  vocabulary, assigned by GPT-4o-mini with a confidence score.

2. New Tables
- `tags`: the controlled vocabulary.
  - `id` (uuid, primary key)
  - `value` (text, unique, not null) — machine key sent to the model, e.g. 'pool'
  - `label` (text, not null) — human label shown in the UI, e.g. 'Pool'
  - `category` (text, not null) — grouping: condition / lifestyle / investment / character
  - `description` (text, not null) — instructions for the model on when to apply
  - `is_active` (boolean, default true) — inactive tags are never assigned
- `property_tags`: links listings to tags.
  - `id` (uuid, primary key)
  - `property_id` (text, not null, FK to properties.property_id, cascade delete)
  - `tag_id` (uuid, not null, FK to tags.id, cascade delete)
  - `confidence` (numeric, not null) — model-reported confidence, 0-1
  - `model` (text, not null) — which model assigned it, e.g. 'gpt-4o-mini'
  - `tagged_at` (timestamptz, default now)
  - unique on (property_id, tag_id) — one tagging per pair

3. Seed data
- ~24 starter tags across the four categories.

4. Security
- RLS enabled on both tables; anon+authenticated can read (data is public to
  the app). No client write policies — only the classification function
  (service role) writes taggings.

5. Indexes
- tags(category); property_tags(property_id), property_tags(tag_id).
*/

CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  value text UNIQUE NOT NULL,
  label text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS property_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id text NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  confidence numeric NOT NULL,
  model text NOT NULL,
  tagged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, tag_id)
);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_tags" ON tags;
CREATE POLICY "read_tags" ON tags FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "read_property_tags" ON property_tags;
CREATE POLICY "read_property_tags" ON property_tags FOR SELECT TO anon, authenticated USING (true);

INSERT INTO tags (value, label, category, description) VALUES
  ('renovated', 'Renovated', 'condition', 'Recently updated kitchen, baths, flooring, or systems described as remodeled, renovated, or brand new.'),
  ('fixer_upper', 'Fixer Upper', 'condition', 'Needs work: mentions TLC, repairs, investor special, as-is condition, or outdated interior.'),
  ('new_construction', 'New Construction', 'condition', 'Newly built or never-lived-in home; year built is recent or listing says new construction.'),
  ('move_in_ready', 'Move-In Ready', 'condition', 'Implies immediate occupancy with no stated repairs or renovation needs.'),
  ('energy_efficient', 'Energy Efficient', 'condition', 'Solar panels, new HVAC, updated windows/insulation, EV charger, or Energy Star features.'),
  ('pool', 'Pool', 'lifestyle', 'Private swimming pool on the property (not a community pool).'),
  ('waterfront', 'Waterfront', 'lifestyle', 'On or directly adjacent to ocean, lake, river, or canal; includes water views described as waterfront.'),
  ('view', 'Great Views', 'lifestyle', 'Scenic views: mountain, city skyline, canyon, golf course, or water views.'),
  ('large_lot', 'Large Lot', 'lifestyle', 'Lot is notably large for the area, acreage, or described as oversized/expansive.'),
  ('outdoor_living', 'Outdoor Living', 'lifestyle', 'Patio, deck, outdoor kitchen, pergola, fire pit, or covered porch emphasized in the description.'),
  ('garage', 'Garage Parking', 'lifestyle', 'Attached or detached garage spaces mentioned.'),
  ('smart_home', 'Smart Home', 'lifestyle', 'Smart thermostat, security system, smart locks, or integrated home automation.'),
  ('pet_friendly', 'Pet Friendly', 'lifestyle', 'Explicitly welcomes pets, or has a fenced yard / dog run mentioned.'),
  ('below_market', 'Below Market Price', 'investment', 'List price appears below comparable homes; listing says priced to sell, motivated seller, or priced under appraised value.'),
  ('price_improved', 'Price Cut', 'investment', 'Current list price is lower than the original list price, or listing mentions a recent price reduction.'),
  ('rental_potential', 'Rental Potential', 'investment', 'Suitable for renting: separate unit, ADU, guest house, or strong rental-income language.'),
  ('investor_special', 'Investor Special', 'investment', 'Cash-flow or ROI language; landlord or investment opportunity framing.'),
  ('historic', 'Historic', 'character', 'Built before 1940 or described as historic, vintage, or with original period details.'),
  ('modern', 'Modern Design', 'character', 'Contemporary or mid-century architecture, open floor plan, clean lines, minimalist finishes.'),
  ('luxury', 'Luxury', 'character', 'High-end finishes, premium appliances, wine cellar, home theater, gated estate, or luxury-brand language.'),
  ('ranch', 'Ranch', 'character', 'Single-story ranch-style layout.'),
  ('townhome_style', 'Townhome Living', 'character', 'Attached townhome/rowhome with low-maintenance living language.'),
  ('cul_de_sac', 'Cul-de-Sac', 'character', 'Located on a cul-de-sac or quiet low-traffic street.'),
  ('gated_community', 'Gated Community', 'character', 'Home sits in a gated or guard-gated community.')
ON CONFLICT (value) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_tags_category ON tags (category);
CREATE INDEX IF NOT EXISTS idx_property_tags_property ON property_tags (property_id);
CREATE INDEX IF NOT EXISTS idx_property_tags_tag ON property_tags (tag_id);
