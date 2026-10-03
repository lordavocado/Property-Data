// Classifies untagged property listings with GPT-4o-mini.
// POST { limit?: number } -> { tagged, batches, skipped }
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
  original_list_price: number | null;
  price_per_sqft: number | null;
  hoa_fee: number | null;
  description_text: string | null;
}

interface Tagging {
  property_id: string;
  value: string;
  confidence: number;
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
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Supabase configuration missing" }, 500);
    }
    if (!openaiKey) {
      return json({ error: "OPENAI_API_KEY not configured" }, 503);
    }

    let limit = 100;
    try {
      const body = await req.json();
      if (body && typeof body.limit === "number" && body.limit > 0 && body.limit <= 500) {
        limit = Math.floor(body.limit);
      }
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
        "property_id, street, city, state, style, beds, full_baths, sqft, lot_sqft, year_built, list_price, original_list_price, price_per_sqft, hoa_fee, description_text"
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
    const allowedValues = new Set(tagList.map((t) => t.value));

    const BATCH_SIZE = 20;
    let totalTagged = 0;
    let batchCount = 0;
    let skipped = 0;

    for (let i = 0; i < untagged.length; i += BATCH_SIZE) {
      const batch: PropertyRow[] = untagged.slice(i, i + BATCH_SIZE);
      const payload = {
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a real-estate listing tagger. You will receive a list of listings, each with facts and a description. " +
              "For each listing choose at most 6 tags from the provided tag list. Only apply a tag when the evidence is explicit. " +
              'Respond with JSON only: {"results": [{"property_id": "...", "tags": [{"value": "...", "confidence": 0.0-1.0}]}]}. ' +
              "Every property_id you were given must appear exactly once in results; use an empty tags array when nothing applies.",
          },
          {
            role: "user",
            content: JSON.stringify({
              tags: tagList.map((t) => ({ value: t.value, category: t.category, description: t.description })),
              listings: batch.map((p) => ({
                property_id: p.property_id,
                facts: {
                  type: p.style,
                  beds: p.beds,
                  baths: p.full_baths,
                  sqft: p.sqft,
                  lot_sqft: p.lot_sqft,
                  year_built: p.year_built,
                  list_price: p.list_price,
                  original_list_price: p.original_list_price,
                  price_per_sqft: p.price_per_sqft,
                  hoa_fee: p.hoa_fee,
                },
                location: [p.street, p.city, p.state].filter(Boolean).join(", "),
                description: (p.description_text ?? "").slice(0, 1200),
              })),
            }),
          },
        ],
      };

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`OpenAI request failed (${resp.status}): ${errText.slice(0, 300)}`);
      }

      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        skipped += batch.length;
        continue;
      }

      let parsed: { results?: { property_id?: string; tags?: { value?: string; confidence?: number }[] }[] };
      try {
        parsed = JSON.parse(content);
      } catch {
        skipped += batch.length;
        continue;
      }

      const rows: {
        property_id: string;
        tag_id: string;
        confidence: number;
        model: string;
      }[] = [];
      const batchIds = new Set(batch.map((p) => p.property_id));

      for (const r of parsed.results ?? []) {
        if (!r || typeof r.property_id !== "string" || !batchIds.has(r.property_id)) continue;
        for (const t of r.tags ?? []) {
          if (typeof t.value !== "string" || !allowedValues.has(t.value)) continue;
          const conf = typeof t.confidence === "number" && t.confidence >= 0 && t.confidence <= 1 ? t.confidence : 0.5;
          rows.push({
            property_id: r.property_id,
            tag_id: valueToId.get(t.value)!,
            confidence: conf,
            model: "gpt-4o-mini",
          });
        }
      }

      if (rows.length > 0) {
        const { error: insertErr } = await admin
          .from("property_tags")
          .upsert(rows, { onConflict: "property_id,tag_id", ignoreDuplicates: true });
        if (insertErr) throw insertErr;
        totalTagged += batch.length;
      } else {
        skipped += batch.length;
      }
      batchCount += 1;
    }

    return json({ tagged: totalTagged, batches: batchCount, skipped });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Classification failed" },
      500
    );
  }
});
