// Ingest endpoints for the Python scraper. Protected by a shared secret header.
import express from "express";
import { Property, ScrapeBatch } from "./models.js";
import type { PropertyDoc } from "../shared/types.js";

export const ingestRouter = express.Router();

function authorized(req: express.Request): boolean {
  const expected = process.env.INGEST_SECRET;
  if (!expected) return true; // no secret configured: local dev, allow
  return req.header("x-ingest-secret") === expected;
}

ingestRouter.use((req, res, next) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): Date | null {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRecord(r: any): Partial<PropertyDoc> {
  const status = String(r.status ?? "OTHER").toUpperCase();
  const style = String(r.style ?? "OTHER").toUpperCase();
  const listPrice = toNumber(r.list_price);
  return {
    propertyId: r.property_id ? String(r.property_id) : undefined,
    listingId: r.listing_id ?? null,
    permalink: r.permalink ?? null,
    mls: r.mls ?? null,
    mlsId: r.mls_id ?? null,
    source: r.source ?? "Realtor.com",
    status: r.status ?? null,
    listingStatus: STATUS_MAP[status] ?? "UNKNOWN",
    mlsStatus: r.mls_status ?? null,
    style: r.style ?? null,
    propertyType: STYLE_MAP[style] ?? "OTHER",
    street: r.street ?? null,
    unit: r.unit ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    zipCode: r.zip_code ?? null,
    county: r.county ?? null,
    formattedAddress: r.formatted_address ?? null,
    beds: toNumber(r.beds),
    fullBaths: toNumber(r.full_baths),
    halfBaths: toNumber(r.half_baths),
    sqft: toNumber(r.sqft),
    lotSqft: toNumber(r.lot_sqft),
    yearBuilt: toNumber(r.year_built) ?? null,
    daysOnMls: toNumber(r.days_on_mls),
    listPrice,
    listPriceMin: toNumber(r.list_price_min),
    listPriceMax: toNumber(r.list_price_max),
    listDate: toDate(r.list_date)?.toISOString() ?? null,
    pendingDate: toDate(r.pending_date)?.toISOString() ?? null,
    soldPrice: toNumber(r.sold_price),
    lastSoldDate: toDate(r.last_sold_date)?.toISOString() ?? null,
    lastSoldPrice: toNumber(r.last_sold_price),
    lastStatusChangeDate: toDate(r.last_status_change_date)?.toISOString() ?? null,
    lastUpdateDate: toDate(r.last_update_date)?.toISOString() ?? null,
    pricePerSqft: toNumber(r.price_per_sqft),
    assessedValue: toNumber(r.assessed_value),
    estimatedValue: toNumber(r.estimated_value),
    newConstruction: r.new_construction === true,
    hoaFee: toNumber(r.hoa_fee),
    stories: toNumber(r.stories),
    parkingGarage: toNumber(r.parking_garage),
    latitude: toNumber(r.latitude),
    longitude: toNumber(r.longitude),
    neighborhoods: r.neighborhoods ?? null,
    fipsCode: r.fips_code ?? null,
    propertyUrl: r.property_url ?? null,
    primaryPhoto: r.primary_photo ?? null,
    agentName: r.agent_name ?? null,
    agentEmail: r.agent_email ?? null,
    brokerName: r.broker_name ?? null,
    officeName: r.office_name ?? null,
    descriptionText: r.description_text ?? null,
    searchArea: r.search_area ?? null,
    searchAreaNorm: r.search_area ? String(r.search_area).toLowerCase() : null,
    priceBucket: priceBucket(listPrice),
    batchId: r.batch_id ?? null,
    scrapedAt: (r.scraped_at ? toDate(r.scraped_at) : new Date())?.toISOString() ?? new Date().toISOString(),
  };
}

ingestRouter.post("/scrape-batch", async (req, res) => {
  try {
    const body = req.body as {
      source?: string;
      listingType?: string;
      locations?: string[];
    };
    const batch = await ScrapeBatch.create({
      source: body.source ?? "Realtor.com",
      listingType: body.listingType ?? "",
      locations: body.locations ?? [],
      status: "running",
    });
    res.json({ batchId: String(batch._id) });
  } catch (err) {
    console.error("[ingest:batch]", err);
    res.status(500).json({ error: "Failed to create batch" });
  }
});

ingestRouter.post("/properties", async (req, res) => {
  try {
    const body = req.body as { records?: unknown[] };
    const records = Array.isArray(body.records) ? body.records : [];
    if (records.length === 0) {
      res.json({ upserted: 0 });
      return;
    }
    const docs = records
      .map(mapRecord)
      .filter((d): d is ReturnType<typeof mapRecord> & { propertyId: string } =>
        Boolean(d.propertyId)
      );
    const result = await (Property.collection as unknown as {
      bulkWrite: (
        writes: object[],
        opts?: { ordered?: boolean }
      ) => Promise<{ upsertedCount?: number; modifiedCount?: number }>;
    }).bulkWrite(
      docs.map((d) => ({
        replaceOne: {
          filter: { propertyId: d.propertyId },
          replacement: d,
          upsert: true,
        },
      })),
      { ordered: false }
    );
    res.json({ upserted: (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0) });
  } catch (err) {
    console.error("[ingest:properties]", err);
    res.status(500).json({ error: "Failed to store properties" });
  }
});

ingestRouter.post("/scrape-batch/:id/finish", async (req, res) => {
  try {
    const { rowCount, status, error } = req.body as {
      rowCount?: number;
      status?: string;
      error?: string;
    };
    await ScrapeBatch.findByIdAndUpdate(req.params.id, {
      finishedAt: new Date(),
      rowCount: rowCount ?? 0,
      status: status === "completed" ? "completed" : "failed",
      error: error ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[ingest:finish]", err);
    res.status(500).json({ error: "Failed to finish batch" });
  }
});
