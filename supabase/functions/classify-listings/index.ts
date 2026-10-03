// Classifies untagged property listings with the Jev decision model (TypeSafe)
// via OpenRouter's Decisions API. One request per listing; one yes/no question
// per active tag. A tag is applied when its yes-probability clears THRESHOLD.
// POST { limit?: number } -> { tagged, batches, skipped, cost }
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TagRow {
  id: string;
  value: string;
  label: string;
  category: string;
  description: string;
}

interface PropertyRow {
  property_id: string;
  street: string | null;
  city: string | null;
  state: string | null;
  style: string | null;
  beds: number | null;
  full_baths: number | null;
  sqft: number | null;
  lot_sqft: number | null;
  year_built: number | null;
  list_price: number | null;
  days_on_mls: number | null;
  price_per_sqft: number | null;
  hoa_fee: number | null;
  description_text: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Supabase configuration missing" }, 500);
    }
    if (!openrouterKey) {
      return json({ error: "OPENROUTER_API_KEY not configured" }, 503);
    }

    let limit = 100;
    let debug = false;
    try {
      const body = await req.json();
      if (body && typeof body.limit === "number" && body.limit > 0 && body.limit <= 500) {
        limit = Math.floor(body.limit);
      }
      if (body && body.debug === true) debug = true;
    } catch {
      // empty body is fine; use default limit
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: tagRows, error: tagErr } = await admin
      .from("tags")
      .select("id, value, label, category, description")
      .eq("is_active", true);
    if (tagErr) throw tagErr;

    // Listings that have no taggings at all, oldest first.
    const { data: taggedIds, error: ptErr } = await admin
      .from("property_tags")
      .select("property_id");
    if (ptErr) throw ptErr;
    const taggedSet = new Set((taggedIds ?? []).map((r: { property_id: string }) => r.property_id));

    const { data: allProps, error: propErr } = await admin
      .from("properties")
      .select(
        "property_id, street, city, state, style, beds, full_baths, sqft, lot_sqft, year_built, list_price, days_on_mls, price_per_sqft, hoa_fee, description_text"
      )
      .order("scraped_at", { ascending: true })
      .limit(limit + taggedSet.size);
    if (propErr) throw propErr;

    const untagged = (allProps ?? []).filter(
      (p: PropertyRow) => !taggedSet.has(p.property_id)
    ).slice(0, limit);

    if (!untagged || untagged.length === 0) {
      return json({ tagged: 0, batches: 0, skipped: 0 });
    }

    const tagList = tagRows as TagRow[];
    const valueToId = new Map(tagList.map((t) => [t.value, t.id]));

    const THRESHOLD = 0.7;
    let totalTagged = 0;
    let batchCount = 0;
    let skipped = 0;
    let totalCost = 0;
    let debugSample: unknown = null;

    for (const p of untagged as PropertyRow[]) {
      const state = {
        location: [p.street, p.city, p.state].filter(Boolean).join(", "),
        facts: {
          type: p.style,
          beds: p.beds,
          baths: p.full_baths,
          sqft: p.sqft,
          lot_sqft: p.lot_sqft,
          year_built: p.year_built,
          list_price: p.list_price,
          days_on_mls: p.days_on_mls,
          price_per_sqft: p.price_per_sqft,
          hoa_fee: p.hoa_fee,
        },
        description: (p.description_text ?? "").slice(0, 1200),
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
        body: JSON.stringify({
          model: "typesafe/jev-1.13",
          state,
          questions,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`OpenRouter request failed (${resp.status}): ${errText.slice(0, 300)}`);
      }

      const data = await resp.json();
      if (debug && debugSample === null) debugSample = data;
      totalCost += typeof data?.usage?.cost === "number" ? data.usage.cost : 0;
      const answers = data?.answers;
      if (!answers || typeof answers !== "object") {
        skipped += 1;
        continue;
      }

      const rows: {
        property_id: string;
        tag_id: string;
        confidence: number;
        model: string;
      }[] = [];

      for (const t of tagList) {
        const a = answers[t.value];
        const pYes = typeof a?.noul === "number" ? a.noul : 0;
        if (pYes >= THRESHOLD) {
          rows.push({
            property_id: p.property_id,
            tag_id: valueToId.get(t.value)!,
            confidence: pYes,
            model: "typesafe/jev-1.13",
          });
        }
      }

      if (rows.length > 0) {
        const { error: insertErr } = await admin
          .from("property_tags")
          .upsert(rows, { onConflict: "property_id,tag_id", ignoreDuplicates: true });
        if (insertErr) throw insertErr;
      }
      totalTagged += 1;
      batchCount += 1;
    }

    return json({
      tagged: totalTagged,
      batches: batchCount,
      skipped,
      cost_usd: Math.round(totalCost * 10000) / 10000,
      ...(debug ? { debugSample } : {}),
    });
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Classification failed";
    return json({ error: msg }, 500);
  }
});
