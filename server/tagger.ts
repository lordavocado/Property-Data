// AI tagging: calls OpenRouter's Decisions API (Jev model) per untagged listing,
// one yes/no question per active tag. Ported from the former Supabase edge function.
import { getActiveTags, getUntaggedProperties, saveTaggings } from "./listings.js";

const THRESHOLD = 0.7;
const MODEL = "typesafe/jev-1.13";

interface ActiveTag {
  value: string;
  label: string;
  category: string;
  description: string;
}

interface PropertyLike {
  propertyId: string;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  style?: string | null;
  beds?: number | null;
  fullBaths?: number | null;
  sqft?: number | null;
  lotSqft?: number | null;
  yearBuilt?: number | null;
  listPrice?: number | null;
  daysOnMls?: number | null;
  pricePerSqft?: number | null;
  hoaFee?: number | null;
  descriptionText?: string | null;
}

export async function runClassification(limit: number): Promise<{
  tagged: number;
  batches: number;
  skipped: number;
  costUsd: number;
}> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const tagList = (await getActiveTags()) as ActiveTag[];
  const untagged = (await getUntaggedProperties(limit)) as PropertyLike[];
  if (untagged.length === 0) {
    return { tagged: 0, batches: 0, skipped: 0, costUsd: 0 };
  }

  let totalTagged = 0;
  let batches = 0;
  let skipped = 0;
  let totalCost = 0;

  for (const p of untagged) {
    const state = {
      location: [p.street, p.city, p.state].filter(Boolean).join(", "),
      facts: {
        type: p.style,
        beds: p.beds,
        baths: p.fullBaths,
        sqft: p.sqft,
        lot_sqft: p.lotSqft,
        year_built: p.yearBuilt,
        list_price: p.listPrice,
        days_on_mls: p.daysOnMls,
        price_per_sqft: p.pricePerSqft,
        hoa_fee: p.hoaFee,
      },
      description: (p.descriptionText ?? "").slice(0, 1200),
    };

    const questions: Record<string, unknown> = {};
    for (const t of tagList) {
      questions[t.value] = {
        type: "noul",
        instructions: `Does this listing match the tag "${t.label}"?`,
        criteria: {
          true: t.description,
          false: `The listing gives no explicit evidence for "${t.label}".`,
        },
      };
    }

    const resp = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, state, questions }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`OpenRouter request failed (${resp.status}): ${errText.slice(0, 300)}`);
    }

    const data = await resp.json();
    totalCost += typeof data?.usage?.cost === "number" ? data.usage.cost : 0;
    const answers = data?.answers;
    if (!answers || typeof answers !== "object") {
      skipped += 1;
      continue;
    }

    const rows = [];
    for (const t of tagList) {
      const a = answers[t.value];
      const pYes = typeof a?.noul === "number" ? a.noul : 0;
      if (pYes >= THRESHOLD) {
        rows.push({
          propertyId: p.propertyId,
          tagValue: t.value,
          confidence: pYes,
          model: MODEL,
        });
      }
    }

    await saveTaggings(rows);
    totalTagged += 1;
    batches += 1;
  }

  return {
    tagged: totalTagged,
    batches,
    skipped,
    costUsd: Math.round(totalCost * 10000) / 10000,
  };
}
