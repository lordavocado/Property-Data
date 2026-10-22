// Express API server. The browser talks only to this; MongoDB is never exposed.
import "dotenv/config";
import express from "express";
import { connectDb } from "./db.js";
import { listListings, getFacets } from "./listings.js";
import { runClassification } from "./tagger.js";
import { ingestRouter } from "./ingest.js";

void connectDb();

const PORT = Number(process.env.PORT || 3001);
const TAG_LIMIT_MAX = 500;
const TAG_LIMIT_DEFAULT = 100;

const app = express();
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/listings", async (req, res) => {
  try {
    const page = Math.max(0, parseInt(String(req.query.page ?? "0"), 10) || 0);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "25"), 10) || 25;
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
    const dir = req.query.sortDir === "asc" ? "asc" : "desc";

    const { rows, total } = await listListings({
      page,
      pageSize,
      search: String(req.query.search ?? ""),
      area: String(req.query.area ?? "all"),
      status: String(req.query.status ?? "all"),
      type: String(req.query.type ?? "all"),
      tag: String(req.query.tag ?? "all"),
      sortKey: String(req.query.sortKey ?? "listPrice"),
      sortDir: dir,
    });
    res.json({ rows, total, page, pageSize });
  } catch (err) {
    console.error("[listings]", err);
    res.status(500).json({ error: "Failed to load listings" });
  }
});

app.get("/api/facets", async (_req, res) => {
  try {
    res.json(await getFacets());
  } catch (err) {
    console.error("[facets]", err);
    res.status(500).json({ error: "Failed to load facets" });
  }
});

app.post("/api/tag-new-listings", async (req, res) => {
  try {
    let limit = TAG_LIMIT_DEFAULT;
    const body = req.body as { limit?: unknown } | undefined;
    if (body && typeof body.limit === "number" && body.limit > 0) {
      limit = Math.min(TAG_LIMIT_MAX, Math.floor(body.limit));
    }
    res.json(await runClassification(limit));
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Classification failed";
    console.error("[tagger]", err);
    res.status(500).json({ error: msg });
  }
});

app.use("/api/ingest", ingestRouter);

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
