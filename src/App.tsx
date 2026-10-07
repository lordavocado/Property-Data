import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import type { PropertyRow } from "./types";

const PAGE_SIZE = 25;

type SortKey =
  | "list_price"
  | "beds"
  | "sqft"
  | "price_per_sqft"
  | "days_on_mls"
  | "year_built"
  | "city"
  | "state"
  | "list_date";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

const COLUMNS: { key: SortKey | "zip_code"; label: string; sortable: boolean }[] = [
  { key: "city", label: "City", sortable: true },
  { key: "state", label: "State", sortable: true },
  { key: "zip_code", label: "ZIP", sortable: false },
  { key: "list_price", label: "Price", sortable: true },
  { key: "beds", label: "Beds", sortable: true },
  { key: "sqft", label: "Sq Ft", sortable: true },
  { key: "price_per_sqft", label: "$/SqFt", sortable: true },
  { key: "days_on_mls", label: "Days on MLS", sortable: true },
  { key: "list_date", label: "Listed", sortable: true },
  { key: "year_built", label: "Built", sortable: true },
];

function formatPrice(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatNum(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusBadge(status: string | null): { label: string; cls: string } {
  const s = (status ?? "").toUpperCase();
  if (s === "FOR_SALE") return { label: "For Sale", cls: "badge-for-sale" };
  if (s === "PENDING") return { label: "Pending", cls: "badge-pending" };
  if (s === "CONTINGENT") return { label: "Contingent", cls: "badge-contingent" };
  if (s === "SOLD") return { label: "Sold", cls: "badge-sold" };
  return { label: s || "Unknown", cls: "badge-other" };
}

export default function App() {
  const [rows, setRows] = useState<PropertyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState<SortState>({ key: "list_price", dir: "desc" });
  const [detail, setDetail] = useState<PropertyRow | null>(null);
  const [areas, setAreas] = useState<{ label: string; norm: string; count: number }[]>([]);
  const [types, setTypes] = useState<{ value: string; label: string }[]>([]);
  const [tagFilter, setTagFilter] = useState("all");
  const [tagOptions, setTagOptions] = useState<{ value: string; label: string; category: string }[]>([]);
  const [refreshFlag, setFlag] = useState(0);
  const [tagging, setTagging] = useState(false);
  const [tagResult, setTagResult] = useState<string | null>(null);

  const runTagging = async () => {
    setTagging(true);
    setTagResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("classify-listings", {
        body: { limit: 200 },
      });
      if (error) throw error;
      const r = data as { tagged?: number; skipped?: number; cost_usd?: number };
      setTagResult(
        `Tagged ${r.tagged ?? 0} new listing${(r.tagged ?? 0) === 1 ? "" : "s"} — refresh to see them.`
      );
      // Reload data so new tags show up immediately
      setFlag((f) => f + 1);
    } catch (e) {
      setTagResult(e instanceof Error ? `Tagging failed: ${e.message}` : "Tagging failed.");
    } finally {
      setTagging(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        let query = supabase
          .from("properties_with_tags")
          .select("*", { count: "exact" })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

        if (search.trim()) {
          const term = `%${search.trim()}%`;
          query = query.or(
            `street.ilike.${term},city.ilike.${term},zip_code.ilike.${term}`
          );
        }
        if (areaFilter !== "all") {
          query = query.eq("search_area_norm", areaFilter.toLowerCase());
        }
        if (statusFilter !== "all") {
          query = query.eq("listing_status", statusFilter);
        }
        if (typeFilter !== "all") {
          query = query.eq("property_type", typeFilter);
        }
        if (tagFilter !== "all") {
          query = query.contains("tag_values", [tagFilter]);
        }

        query = query.order(sort.key, { ascending: sort.dir === "asc" });

        const { data, error: err, count } = await query;
        if (cancelled) return;
        if (err) throw err;
        setRows(data ?? []);
        setTotal(count ?? 0);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load properties");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page, search, areaFilter, statusFilter, typeFilter, tagFilter, sort, refreshFlag]);

  // Load facet options from taxonomy tables (scales to any number of areas)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [areasRes, typesRes, tagsRes] = await Promise.all([
          supabase
            .from("dim_areas")
            .select("search_area_norm, display_label, listing_count")
            .order("listing_count", { ascending: false })
            .limit(200),
          supabase.from("dim_property_types").select("value, label").order("sort_order"),
          supabase
            .from("tags")
            .select("value, label, category")
            .eq("is_active", true)
            .order("category, label"),
        ]);
        if (cancelled) return;
        if (areasRes.data) {
          setAreas(
            areasRes.data.map((a) => ({
              label: a.display_label,
              norm: a.search_area_norm,
              count: a.listing_count,
            }))
          );
        }
        if (typesRes.data) setTypes(typesRes.data);
        if (tagsRes.data) setTagOptions(tagsRes.data);
      } catch {
        // facet load failure is non-fatal; filters fall back to "all"
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const startNum = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const endNum = Math.min(total, (page + 1) * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" }
    );
    setPage(0);
  };

  return (
    <div className="shell">
      <header className="header">
        <div>
          <h1>Property Listings</h1>
          <div className="sub">Live real-estate data scraped from Realtor.com</div>
        </div>
        <div className="header-actions">
          {tagResult && <span className="tag-result-note">{tagResult}</span>}
          <button className="tag-btn" onClick={runTagging} disabled={tagging}>
            {tagging ? (
              <>
                <span className="spinner spinner-sm" /> Tagging…
              </>
            ) : (
              "Tag new listings"
            )}
          </button>
        </div>
        <div className="count-badge">
          <strong>{total}</strong> listings
        </div>
      </header>

      <div className="filter-bar">
        <div className="search-wrap">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="search-input"
            placeholder="Search street, city, or ZIP…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <select
          className="select"
          value={areaFilter.toLowerCase()}
          onChange={(e) => {
            setAreaFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">All areas</option>
          {areas.map((a) => (
            <option key={a.norm} value={a.norm}>
              {a.label} ({a.count})
            </option>
          ))}
        </select>
        <select
          className="select"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">All statuses</option>
          <option value="FOR_SALE">For Sale</option>
          <option value="PENDING">Pending</option>
          <option value="CONTINGENT">Contingent</option>
          <option value="SOLD">Sold</option>
        </select>
        <select
          className="select"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={tagFilter}
          onChange={(e) => {
            setTagFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">All tags</option>
          {tagOptions.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Address</th>
                <th>Tags</th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`${col.sortable ? "sortable" : ""} ${sort.key === col.key ? "sorted" : ""}`}
                    onClick={col.sortable ? () => toggleSort(col.key as SortKey) : undefined}
                  >
                    {col.label}
                    <span className="sort-arrow">
                      {sort.key === col.key ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </th>
                ))}
                <th>Status</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={COLUMNS.length + 4}>
                    <div className="state">
                      <div className="spinner" />
                      <h3>Loading listings…</h3>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={COLUMNS.length + 4}>
                    <div className="state">
                      <h3>Something went wrong</h3>
                      <p>{error}</p>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 4}>
                    <div className="state">
                      <h3>No listings found</h3>
                      <p>Try adjusting your search or filters.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const badge = statusBadge(r.status);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setDetail(r)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <div className="cell-with-photo">
                          {r.primary_photo && (
                            <img
                              className="row-thumb"
                              src={r.primary_photo}
                              alt=""
                              loading="lazy"
                            />
                          )}
                          <div className="cell-address">
                            {r.street ?? r.formatted_address ?? "—"}
                            {r.unit ? ` ${r.unit}` : ""}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="tag-chips">
                          {(r.tag_labels ?? []).slice(0, 3).map((tl) => (
                            <span key={tl} className="tag-chip">{tl}</span>
                          ))}
                          {(r.tag_labels ?? []).length > 3 && (
                            <span className="tag-chip tag-chip-more">+{(r.tag_labels ?? []).length - 3}</span>
                          )}
                          {(r.tag_labels ?? []).length === 0 && <span className="cell-dim">—</span>}
                        </div>
                      </td>
                      {COLUMNS.map((col) => {
                        if (col.key === "list_price")
                          return (
                            <td key={col.key} className="cell-price">
                              {formatPrice(r.list_price)}
                            </td>
                          );
                        if (col.key === "price_per_sqft")
                          return (
                            <td key={col.key} className="cell-num">
                              {r.price_per_sqft != null ? `${formatNum(r.price_per_sqft)}` : "—"}
                            </td>
                          );
                        if (col.key === "list_date")
                          return (
                            <td key={col.key} className="cell-num">
                              {formatDate(r.list_date)}
                            </td>
                          );
                        if (col.key === "city")
                          return (
                            <td key={col.key} className="cell-city">
                              {r.city ?? "—"}
                            </td>
                          );
                        if (col.key === "state")
                          return (
                            <td key={col.key} className="cell-num">
                              {r.state ?? "—"}
                            </td>
                          );
                        if (col.key === "zip_code")
                          return (
                            <td key={col.key} className="cell-dim">
                              {r.zip_code ?? "—"}
                            </td>
                          );
                        return (
                          <td key={col.key} className="cell-num">
                            {formatNum(r[col.key] as number | null)}
                          </td>
                        );
                      })}
                      <td>
                        <span className={`badge ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td>
                        <span className="cell-dim" title={r.mls ? `MLS: ${r.mls}` : undefined}>
                          {r.source ?? "Realtor.com"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <div className="info">
            Showing {startNum}–{endNum} of {total}
          </div>
          <div className="page-btns">
            <button
              className="page-btn"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ← Prev
            </button>
            <button
              className="page-btn"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {detail && <DetailDrawer row={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function DetailDrawer({ row, onClose }: { row: PropertyRow; onClose: () => void }) {
  const badge = statusBadge(row.status);
  const items: { label: string; value: string }[] = [
    { label: "Status", value: badge.label },
    { label: "Property type", value: (row.style ?? "").replace(/_/g, " ").toLowerCase() || "—" },    { label: "Beds", value: row.beds != null ? String(row.beds) : "—" },
    {
      label: "Baths",
      value:
        row.full_baths != null || row.half_baths != null
          ? `${row.full_baths ?? 0} full / ${row.half_baths ?? 0} half`
          : "—",
    },
    { label: "Interior", value: row.sqft != null ? `${formatNum(row.sqft)} sq ft` : "—" },
    { label: "Lot", value: row.lot_sqft != null ? `${formatNum(row.lot_sqft)} sq ft` : "—" },
    { label: "Year built", value: row.year_built != null ? String(row.year_built) : "—" },
    { label: "Price / sqft", value: row.price_per_sqft != null ? `$${formatNum(row.price_per_sqft)}` : "—" },
    { label: "HOA fee", value: row.hoa_fee != null ? `${formatPrice(row.hoa_fee)}/mo` : "—" },
    { label: "Estimated value", value: formatPrice(row.estimated_value) },
    { label: "Last sold", value: row.last_sold_price != null ? formatPrice(row.last_sold_price) : "—" },
    { label: "Days on MLS", value: row.days_on_mls != null ? String(row.days_on_mls) : "—" },
    { label: "Listed on", value: formatDate(row.list_date) },
    { label: "Last updated", value: formatDate(row.last_update_date) },
    { label: "Source", value: row.source ?? (row.mls ? `MLS ${row.mls}` : "Realtor.com") },
    { label: "Search area", value: row.search_area ?? "—" },
    { label: "Data quality", value: `${row.data_quality_score ?? "—"} / 100` },
  ];

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-header">
          <div>
            <h2>
              {row.street ?? "Property"}
              {row.unit ? ` ${row.unit}` : ""}
            </h2>
            <div className="sub">
              {[row.city, row.state].filter(Boolean).join(", ")}
              {row.zip_code ? ` ${row.zip_code}` : ""}
            </div>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="drawer-body">
          {row.primary_photo && (
            <img
              className="drawer-photo"
              src={row.primary_photo}
              alt={row.street ?? "Property photo"}
            />
          )}
          <div style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
            <span className="cell-price" style={{ fontSize: 22 }}>
              {formatPrice(row.list_price)}
            </span>
            <span className={`badge ${badge.cls}`}>{badge.label}</span>
          </div>

          {(row.tag_labels ?? []).length > 0 && (
            <div className="tag-chips" style={{ marginBottom: 16 }}>
              {(row.tag_labels ?? []).map((tl) => (
                <span key={tl} className="tag-chip">{tl}</span>
              ))}
            </div>
          )}

          <div className="detail-grid">
            {items.map((it) => (
              <div className="detail-item" key={it.label}>
                <div className="label">{it.label}</div>
                <div className="value">{it.value}</div>
              </div>
            ))}
          </div>

          {row.agent_name && (
            <div className="drawer-section">
              <h4>Listing agent</h4>
              <div className="agent-line">
                <strong>{row.agent_name}</strong>
                {row.broker_name && <span>{row.broker_name}</span>}
                {row.office_name && <span>{row.office_name}</span>}
              </div>
            </div>
          )}

          {row.description_text && (
            <div className="drawer-section">
              <h4>Description</h4>
              <p className="description">{row.description_text}</p>
            </div>
          )}

          {row.property_url && (
            <div className="drawer-section">
              <a
                className="link-btn"
                href={row.property_url}
                target="_blank"
                rel="noreferrer"
              >
                View full listing ↗
              </a>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
