// Shared TypeScript types for the server and frontend.

export interface PropertyDoc {
  propertyId: string;
  listingId?: string | null;
  permalink?: string | null;
  mls?: string | null;
  mlsId?: string | null;
  source?: string | null;
  status?: string | null;
  listingStatus?: string | null;
  mlsStatus?: string | null;
  style?: string | null;
  propertyType?: string | null;
  street?: string | null;
  unit?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  county?: string | null;
  formattedAddress?: string | null;
  beds?: number | null;
  fullBaths?: number | null;
  halfBaths?: number | null;
  sqft?: number | null;
  lotSqft?: number | null;
  yearBuilt?: number | null;
  daysOnMls?: number | null;
  listPrice?: number | null;
  listPriceMin?: number | null;
  listPriceMax?: number | null;
  listDate?: string | null;
  pendingDate?: string | null;
  soldPrice?: number | null;
  lastSoldDate?: string | null;
  lastSoldPrice?: number | null;
  lastStatusChangeDate?: string | null;
  lastUpdateDate?: string | null;
  pricePerSqft?: number | null;
  assessedValue?: number | null;
  estimatedValue?: number | null;
  newConstruction?: boolean | null;
  hoaFee?: number | null;
  stories?: number | null;
  parkingGarage?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  neighborhoods?: string | null;
  fipsCode?: string | null;
  propertyUrl?: string | null;
  primaryPhoto?: string | null;
  agentName?: string | null;
  agentEmail?: string | null;
  brokerName?: string | null;
  officeName?: string | null;
  descriptionText?: string | null;
  searchArea?: string | null;
  searchAreaNorm?: string | null;
  priceBucket?: string | null;
  dataQualityScore?: number | null;
  batchId?: string | null;
  scrapedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  tagValues?: string[];
  tagLabels?: string[];
}

export interface ListingsResponse {
  rows: PropertyDoc[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AreaFacet {
  label: string;
  norm: string;
  count: number;
}

export interface FacetsResponse {
  areas: AreaFacet[];
  types: { value: string; label: string }[];
  tags: { value: string; label: string; category: string }[];
}

export interface TagRunResponse {
  tagged: number;
  batches: number;
  skipped: number;
  costUsd: number;
  error?: string;
}
