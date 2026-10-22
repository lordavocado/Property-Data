// One-time migration: copy all data from Supabase (Postgres) into MongoDB.
// Reads SUPABASE_URL + SUPABASE_ANON_KEY from .env; writes into MONGODB_URI.
// Usage: npx tsx server/seed-from-supabase.ts
import "dotenv/config";
import mongoose from "mongoose";
import { Property, Tag, PropertyTag } from "./models.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing Supabase credentials in environment");
  process.exit(1);
}

interface Row {
  [key: string]: unknown;
}

async function fetchAll(table: string): Promise<Row[]> {
  const rows: Row[] = [];
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=${pageSize}&offset=${offset}`;
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY!}`,
      },
    });
    if (!resp.ok) {
      throw new Error(`Fetch ${table} failed: ${resp.status} ${await resp.text()}`);
    }
    const chunk = (await resp.json()) as Row[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function date(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

const STATUS_MAP: Record<string, string> = {
  FOR_SALE: "FOR_SALE",
  PENDING: "PENDING",
  CONTINGENT: "CONTINGENT",
  SOLD: "SOLD",
  OFF_MARKET: "OFF_MARKET",
  OTHER: "UNKNOWN",
};

const STYLE_MAP: Record<string, string> = {
  SINGLE_FAMILY: "SINGLE_FAMILY",
  CONDO: "CONDO",
  CONDOS: "CONDO",
  CONDO_TOWNHOME_ROWHOME_COOP: "CONDO",
  TOWNHOME: "TOWNHOME",
  TOWNHOMES: "TOWNHOME",
  MULTI_FAMILY: "MULTI_FAMILY",
  MOBILE: "MOBILE",
  LAND: "LAND",
  APARTMENT: "APARTMENT",
};

function priceBucket(price: number | null): string | null {
  if (price == null) return null;
  if (price < 200000) return "<200k";
  if (price < 400000) return "200-400k";
  if (price < 600000) return "400-600k";
  if (price < 800000) return "600-800k";
  if (price < 1000000) return "800k-1m";
  if (price < 2000000) return "1-2m";
  return "2m+";
}

async function main() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/homeharvest";
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log("[seed] connected to mongo");

  const [props, tags, ptagRows] = await Promise.all([
    fetchAll("properties_with_tags"),
    fetchAll("tags"),
    fetchAll("property_tags"),
  ]);
  console.log(
    `[seed] supabase: ${props.length} properties, ${tags.length} tags, ${ptagRows.length} taggings`
  );

  const tagValueToId = new Map(
    (tags as { id: string; value: string }[]).map((t) => [t.id, t.value])
  );

  // --- tags ---
  await Tag.deleteMany({});
  await Tag.insertMany(
    (tags as Record<string, unknown>[]).map((t) => ({
      value: String(t.value),
      label: String(t.label),
      category: String(t.category),
      description: String(t.description),
      isActive: t.is_active !== false,
    }))
  );

  // --- properties ---
  await Property.deleteMany({});
  const docs = props.map((p) => {
    const listPrice = num(p.list_price);
    const style = String(p.style ?? "").toUpperCase();
    return {
      propertyId: String(p.property_id ?? ""),
      listingId: (p.listing_id as string) ?? null,
      permalink: (p.permalink as string) ?? null,
      mls: (p.mls as string) ?? null,
      mlsId: (p.mls_id as string) ?? null,
      source: (p.source as string) ?? "Realtor.com",
      status: (p.status as string) ?? null,
      listingStatus:
        STATUS_MAP[String(p.listing_status ?? p.status ?? "OTHER").toUpperCase()] ?? "UNKNOWN",
      mlsStatus: (p.mls_status as string) ?? null,
      style: (p.style as string) ?? null,
      propertyType:
        STYLE_MAP[String(p.property_type ?? style ?? "OTHER").toUpperCase()] ??
        String(p.property_type ?? "OTHER"),
      street: (p.street as string) ?? null,
      unit: (p.unit as string) ?? null,
      city: (p.city as string) ?? null,
      state: (p.state as string) ?? null,
      zipCode: (p.zip_code as string) ?? null,
      county: (p.county as string) ?? null,
      formattedAddress: (p.formatted_address as string) ?? null,
      beds: num(p.beds),
      fullBaths: num(p.full_baths),
      halfBaths: num(p.half_baths),
      sqft: num(p.sqft),
      lotSqft: num(p.lot_sqft),
      yearBuilt: num(p.year_built),
      daysOnMls: num(p.days_on_mls),
      listPrice,
      listPriceMin: num(p.list_price_min),
      listPriceMax: num(p.list_price_max),
      listDate: date(p.list_date),
      pendingDate: date(p.pending_date),
      soldPrice: num(p.sold_price),
      lastSoldDate: date(p.last_sold_date),
      lastSoldPrice: num(p.last_sold_price),
      lastStatusChangeDate: date(p.last_status_change_date),
      lastUpdateDate: date(p.last_update_date),
      pricePerSqft: num(p.price_per_sqft),
      assessedValue: num(p.assessed_value),
      estimatedValue: num(p.estimated_value),
      newConstruction: p.new_construction === true,
      hoaFee: num(p.hoa_fee),
      stories: num(p.stories),
      parkingGarage: num(p.parking_garage),
      latitude: num(p.latitude),
      longitude: num(p.longitude),
      neighborhoods: (p.neighborhoods as string) ?? null,
      fipsCode: (p.fips_code as string) ?? null,
      propertyUrl: (p.property_url as string) ?? null,
      primaryPhoto: (p.primary_photo as string) ?? null,
      agentName: (p.agent_name as string) ?? null,
      agentEmail: (p.agent_email as string) ?? null,
      brokerName: (p.broker_name as string) ?? null,
      officeName: (p.office_name as string) ?? null,
      descriptionText: (p.description_text as string) ?? null,
      searchArea: (p.search_area as string) ?? null,
      searchAreaNorm: (p.search_area_norm as string) ?? null,
      priceBucket: priceBucket(listPrice),
      dataQualityScore: num(p.data_quality_score),
      batchId: (p.batch_id as string) ?? null,
      scrapedAt: date(p.scraped_at),
      createdAt: date(p.created_at) ?? new Date(),
    };
  });
  const CHUNK = 100;
  for (let i = 0; i < docs.length; i += CHUNK) {
    await Property.insertMany(docs.slice(i, i + CHUNK).filter((d) => d.propertyId), {
      ordered: false,
    });
  }
  console.log(`[seed] inserted ${docs.length} properties`);

  // --- property tags ---
  await PropertyTag.deleteMany({});
  const tagDocs = ptagRows
    .map((pt) => ({
      propertyId: String(pt.property_id ?? ""),
      tagValue: tagValueToId.get(String(pt.tag_id ?? "")) ?? "",
      confidence: num(pt.confidence) ?? 0,
      model: String(pt.model ?? "unknown"),
      taggedAt: date(pt.tagged_at) ?? new Date(),
    }))
    .filter((d) => d.propertyId && d.tagValue);
  for (let i = 0; i < tagDocs.length; i += CHUNK) {
    await PropertyTag.insertMany(tagDocs.slice(i, i + CHUNK), { ordered: false });
  }
  console.log(`[seed] inserted ${tagDocs.length} taggings`);

  await mongoose.disconnect();
  console.log("[seed] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
