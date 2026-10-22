import { useEffect, useState } from "react";
import { api } from "./lib/api";
import type { PropertyRow } from "./types";

const PAGE_SIZE = 25;

type SortKey =
  | "listPrice"
  | "beds"
  | "sqft"
  | "pricePerSqft"
  | "daysOnMls"
  | "yearBuilt"
  | "city"
  | "state"
  | "listDate";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

const COLUMNS: { key: SortKey | "zipCode"; label: string; sortable: boolean }[] = [
  { key: "city", label: "City", sortable: true },
  { key: "state", label: "State", sortable: true },
  { key: "zipCode", label: "ZIP", sortable: false },
  { key: "listPrice", label: "Price", sortable: true },
  { key: "beds", label: "Beds", sortable: true },
  { key: "sqft", label: "Sq Ft", sortable: true },
  { key: "pricePerSqft", label: "$/SqFt", sortable: true },
  { key: "daysOnMls", label: "Days on MLS", sortable: true },
  { key: "listDate", label: "Listed", sortable: true },
  { key: "yearBuilt", label: "Built", sortable: true },
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
  const [sort, setSort] = useState<SortState>({ key: "listPrice", dir: "desc" });
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
      const r = await api.tagNewListings(200);
      setTagResult(
        `Tagged ${r.tagged} new listing${r.tagged === 1 ? "" : "s"} — refresh to see them.`
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
        const data = await api.listings({
          page,
          pageSize: PAGE_SIZE,
          search,
          area: areaFilter,
          status: statusFilter,
          type: typeFilter,
          tag: tagFilter,
          sortKey: sort.key,
          sortDir: sort.dir,
        });
        if (cancelled) return;
        setRows(data.rows as PropertyRow[]);
        setTotal(data.total);
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

  // Load facet options (scales to any number of areas)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const facets = await api.facets();
        if (cancelled) return;
        setAreas(facets.areas);
        setTypes(facets.types);
        setTagOptions(facets.tags);
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
                  const badge = statusBadge(r.status ?? null);
                  return (
                    <tr
                      key={r.propertyId}
                      onClick={() => setDetail(r)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <div className="cell-with-photo">
                          {r.primaryPhoto && (
                            <img
                              className="row-thumb"
                              src={r.primaryPhoto}
                              alt=""
                              loading="lazy"
                            />
                          )}
                          <div className="cell-address">
                            {r.street ?? r.formattedAddress ?? "—"}
                            {r.unit ? ` ${r.unit}` : ""}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="tag-chips">
                          {(r.tagLabels ?? []).slice(0, 3).map((tl) => (
                            <span key={tl} className="tag-chip">{tl}</span>
                          ))}
                          {(r.tagLabels ?? []).length > 3 && (
                            <span className="tag-chip tag-chip-more">+{(r.tagLabels ?? []).length - 3}</span>
                          )}
                          {(r.tagLabels ?? []).length === 0 && <span className="cell-dim">—</span>}
                        </div>
                      </td>
                      {COLUMNS.map((col) => {
                        if (col.key === "listPrice")
                          return (
                            <td key={col.key} className="cell-price">
                              {formatPrice(r.listPrice ?? null)}
                            </td>
                          );
                        if (col.key === "pricePerSqft")
                          return (
                            <td key={col.key} className="cell-num">
                              {r.pricePerSqft != null ? `${formatNum(r.pricePerSqft)}` : "—"}
                            </td>
                          );
                        if (col.key === "listDate")
                          return (
                            <td key={col.key} className="cell-num">
                              {formatDate(r.listDate ?? null)}
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
                        if (col.key === "zipCode")
                          return (
                            <td key={col.key} className="cell-dim">
                              {r.zipCode ?? "—"}
                            </td>
                          );
                        return (
                          <td key={col.key} className="cell-num">
                            {formatNum((r[col.key as keyof PropertyRow] as number | undefined) ?? null)}
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
  const badge = statusBadge(row.status ?? null);
  const items: { label: string; value: string }[] = [
    { label: "Status", value: badge.label },
    { label: "Property type", value: (row.style ?? "").replace(/_/g, " ").toLowerCase() || "—" },
    { label: "Beds", value: row.beds != null ? String(row.beds) : "—" },
    {
      label: "Baths",
      value:
        row.fullBaths != null || row.halfBaths != null
          ? `${row.fullBaths ?? 0} full / ${row.halfBaths ?? 0} half`
          : "—",
    },
    { label: "Interior", value: row.sqft != null ? `${formatNum(row.sqft)} sq ft` : "—" },
    { label: "Lot", value: row.lotSqft != null ? `${formatNum(row.lotSqft)} sq ft` : "—" },
    { label: "Year built", value: row.yearBuilt != null ? String(row.yearBuilt) : "—" },
    { label: "Price / sqft", value: row.pricePerSqft != null ? `${formatNum(row.pricePerSqft)}` : "—" },
    { label: "HOA fee", value: row.hoaFee != null ? `${formatPrice(row.hoaFee)}/mo` : "—" },
    { label: "Estimated value", value: formatPrice(row.estimatedValue ?? null) },
    { label: "Last sold", value: row.lastSoldPrice != null ? formatPrice(row.lastSoldPrice) : "—" },
    { label: "Days on MLS", value: row.daysOnMls != null ? String(row.daysOnMls) : "—" },
    { label: "Listed on", value: formatDate(row.listDate ?? null) },
    { label: "Last updated", value: formatDate(row.lastUpdateDate ?? null) },
    { label: "Source", value: row.source ?? (row.mls ? `MLS ${row.mls}` : "Realtor.com") },
    { label: "Search area", value: row.searchArea ?? "—" },
    { label: "Data quality", value: `${row.dataQualityScore ?? "—"} / 100` },
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
              {row.zipCode ? ` ${row.zipCode}` : ""}
            </div>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="drawer-body">
          {row.primaryPhoto && (
            <img
              className="drawer-photo"
              src={row.primaryPhoto}
              alt={row.street ?? "Property photo"}
            />
          )}
          <div style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
            <span className="cell-price" style={{ fontSize: 22 }}>
              {formatPrice(row.listPrice ?? null)}
            </span>
            <span className={`badge ${badge.cls}`}>{badge.label}</span>
          </div>

          {(row.tagLabels ?? []).length > 0 && (
            <div className="tag-chips" style={{ marginBottom: 16 }}>
              {(row.tagLabels ?? []).map((tl) => (
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

          {row.agentName && (
            <div className="drawer-section">
              <h4>Listing agent</h4>
              <div className="agent-line">
                <strong>{row.agentName}</strong>
                {row.brokerName && <span>{row.brokerName}</span>}
                {row.officeName && <span>{row.officeName}</span>}
              </div>
            </div>
          )}

          {row.descriptionText && (
            <div className="drawer-section">
              <h4>Description</h4>
              <p className="description">{row.descriptionText}</p>
            </div>
          )}

          {row.propertyUrl && (
            <div className="drawer-section">
              <a
                className="link-btn"
                href={row.propertyUrl}
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
