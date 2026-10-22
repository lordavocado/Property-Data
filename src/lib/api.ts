// Thin HTTP client for the backend API. The browser never touches the database.
const BASE = import.meta.env.VITE_API_URL || "/api";

async function getJson<T>(path: string): Promise<T> {
  const resp = await fetch(`${BASE}${path}`);
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${resp.status})`
    );
  }
  return resp.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    throw new Error(
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${resp.status})`
    );
  }
  return resp.json() as Promise<T>;
}

import type {
  ListingsResponse,
  FacetsResponse,
  TagRunResponse,
} from "../../shared/types";

export const api = {
  listings(params: {
    page: number;
    pageSize: number;
    search: string;
    area: string;
    status: string;
    type: string;
    tag: string;
    sortKey: string;
    sortDir: string;
  }): Promise<ListingsResponse> {
    const qs = new URLSearchParams({
      page: String(params.page),
      pageSize: String(params.pageSize),
      search: params.search,
      area: params.area,
      status: params.status,
      type: params.type,
      tag: params.tag,
      sortKey: params.sortKey,
      sortDir: params.sortDir,
    });
    return getJson<ListingsResponse>(`/listings?${qs}`);
  },
  facets(): Promise<FacetsResponse> {
    return getJson<FacetsResponse>("/facets");
  },
  tagNewListings(limit = 200): Promise<TagRunResponse> {
    return postJson<TagRunResponse>("/tag-new-listings", { limit });
  },
};
