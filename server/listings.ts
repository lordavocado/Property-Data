// Query layer for listings: the single place that knows how the data is stored.
// Everything the API routes need goes through here.
import type { Filter, Sort } from "mongodb";
import { Property, PropertyTag, Tag } from "./models.js";
import type { AreaFacet } from "../shared/types.js";

const SORTABLE = new Set([
  "listPrice",
  "beds",
  "sqft",
  "pricePerSqft",
  "daysOnMls",
  "yearBuilt",
  "city",
  "state",
  "listDate",
]);

const ALLOWED_STATUS = new Set(["FOR_SALE", "PENDING", "CONTINGENT", "SOLD"]);

export interface ListParams {
  page: number;
  pageSize: number;
  search: string;
  area: string;
  status: string;
  type: string;
  tag: string;
  sortKey: string;
  sortDir: "asc" | "desc";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFilter(p: ListParams): Filter<unknown> {
  const q: Record<string, unknown> = {};
  if (p.search.trim()) {
    const re = new RegExp(escapeRegex(p.search.trim()), "i");
    q.$or = [{ street: re }, { city: re }, { zipCode: re }];
  }
  if (p.area && p.area !== "all") q.searchAreaNorm = p.area.toLowerCase();
  if (p.status && p.status !== "all" && ALLOWED_STATUS.has(p.status)) {
    q.listingStatus = p.status;
  }
  if (p.type && p.type !== "all") q.propertyType = p.type;
  if (p.tag && p.tag !== "all") q.tagValue = p.tag; // matched post-lookup against taggings
  return q as Filter<unknown>;
}

export async function listListings(p: ListParams) {
  const q = buildFilter(p) as unknown as Record<string, unknown>;
  const sortKey = SORTABLE.has(p.sortKey) ? p.sortKey : "listPrice";
  const sort: Sort = { [sortKey]: p.sortDir === "asc" ? 1 : -1 };

  const hasTagFilter = "tagValue" in q;
  const tagFilter = q.tagValue;
  delete q.tagValue;

  const pipeline = [
    ...(hasTagFilter
      ? [{ $lookup: {
          from: "propertytags",
          localField: "propertyId",
          foreignField: "propertyId",
          pipeline: [{ $match: { tagValue: tagFilter } }],
          as: "tagMatch",
        } },
        { $match: { "tagMatch.0": { $exists: true } } }]
      : []),
    ...(Object.keys(q).length ? [{ $match: q }] : []),
    {
      $lookup: {
        from: "propertytags",
        localField: "propertyId",
        foreignField: "propertyId",
        as: "taggings",
      },
    },
    {
      $addFields: {
        tagValues: { $setUnion: ["$taggings.tagValue", []] },
      },
    },
    {
      $lookup: {
        from: "tags",
        localField: "tagValues",
        foreignField: "value",
        as: "tagDocs",
      },
    },
    {
      $addFields: {
        tagLabels: { $setUnion: ["$tagDocs.label", []] },
      },
    },
    { $unset: ["taggings", "tagDocs", "__v"] },
    { $facet: {
      rows: [
        { $sort: sort },
        { $skip: p.page * p.pageSize },
        { $limit: p.pageSize },
      ],
      total: [{ $count: "n" }],
    } },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await Property.aggregate(pipeline as any[]);
  const rows = result[0]?.rows ?? [];
  const total = result[0]?.total?.[0]?.n ?? 0;
  return { rows, total };
}

export async function getFacets(): Promise<{
  areas: AreaFacet[];
  types: { value: string; label: string }[];
  tags: { value: string; label: string; category: string }[];
}> {
  const areas = await Property.aggregate<{ _id: string; label: string; count: number }>([
    { $match: { searchArea: { $nin: [null, ""] } } },
    { $group: { _id: "$searchAreaNorm", label: { $first: "$searchArea" }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 200 },
  ]);
  const types = await Property.distinct("propertyType", {
    propertyType: { $nin: [null, ""] },
  });
  const tags = await Tag.find({ isActive: true })
    .sort({ category: 1, label: 1 })
    .select("value label category -_id");

  return {
    areas: areas.map((a) => ({ label: a.label, norm: a._id, count: a.count })),
    types: types.sort().map((v: string) => ({
      value: v,
      label: v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " "),
    })),
    tags: tags
      .filter((t) => t.value && t.label && t.category)
      .map((t) => ({
        value: t.value as string,
        label: t.label as string,
        category: t.category as string,
      })),
  };
}

export async function getUntaggedProperties(limit: number) {
  const tagged = await PropertyTag.distinct("propertyId");
  const q: Record<string, unknown> = { propertyId: { $nin: tagged } };
  return Property.find(q).sort({ scrapedAt: 1 }).limit(limit).lean();
}

export async function saveTaggings(
  rows: { propertyId: string; tagValue: string; confidence: number; model: string }[]
) {
  if (!rows.length) return;
  await PropertyTag.bulkWrite(
    rows.map((r) => ({
      updateOne: {
        filter: { propertyId: r.propertyId, tagValue: r.tagValue },
        update: { $set: r },
        upsert: true,
      },
    })),
    { ordered: false }
  );
}

export async function getActiveTags() {
  return Tag.find({ isActive: true }).select("value label category description -_id").lean();
}
