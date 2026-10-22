import mongoose from "mongoose";

const { Schema } = mongoose;

const propertySchema = new Schema(
  {
    propertyId: { type: String, index: true, unique: true, sparse: true },
    listingId: String,
    permalink: String,
    mls: String,
    mlsId: String,
    source: { type: String, default: "Realtor.com" },
    status: String,
    listingStatus: { type: String, index: true },
    mlsStatus: String,
    style: String,
    propertyType: { type: String, index: true },
    street: { type: String, index: true },
    unit: String,
    city: { type: String, index: true },
    state: { type: String, index: true },
    zipCode: String,
    county: String,
    formattedAddress: String,
    beds: Number,
    fullBaths: Number,
    halfBaths: Number,
    sqft: Number,
    lotSqft: Number,
    yearBuilt: Number,
    daysOnMls: Number,
    listPrice: { type: Number, index: true },
    listPriceMin: Number,
    listPriceMax: Number,
    listDate: Date,
    pendingDate: Date,
    soldPrice: Number,
    lastSoldDate: Date,
    lastSoldPrice: Number,
    lastStatusChangeDate: Date,
    lastUpdateDate: Date,
    pricePerSqft: Number,
    assessedValue: Number,
    estimatedValue: Number,
    newConstruction: Boolean,
    hoaFee: Number,
    stories: Number,
    parkingGarage: Number,
    latitude: Number,
    longitude: Number,
    neighborhoods: String,
    fipsCode: String,
    propertyUrl: String,
    primaryPhoto: String,
    agentName: String,
    agentEmail: String,
    brokerName: String,
    officeName: String,
    descriptionText: String,
    searchArea: String,
    searchAreaNorm: { type: String, index: true },
    priceBucket: String,
    dataQualityScore: Number,
    batchId: String,
    scrapedAt: Date,
  },
  { timestamps: true }
);

propertySchema.index({ street: "text", city: "text", zipCode: "text" });

const tagSchema = new Schema({
  value: { type: String, unique: true, index: true },
  label: String,
  category: { type: String, index: true },
  description: String,
  isActive: { type: Boolean, default: true },
});

const propertyTagSchema = new Schema({
  propertyId: { type: String, index: true },
  tagValue: { type: String, index: true },
  confidence: Number,
  model: String,
  taggedAt: { type: Date, default: Date.now },
});

propertyTagSchema.index({ propertyId: 1, tagValue: 1 }, { unique: true });

const scrapeBatchSchema = new Schema({
  source: { type: String, default: "Realtor.com" },
  startedAt: { type: Date, default: Date.now },
  finishedAt: Date,
  listingType: String,
  locations: [String],
  rowCount: { type: Number, default: 0 },
  status: { type: String, default: "running" },
  error: String,
});

export const Property = mongoose.model("Property", propertySchema);
export const Tag = mongoose.model("Tag", tagSchema);
export const PropertyTag = mongoose.model("PropertyTag", propertyTagSchema);
export const ScrapeBatch = mongoose.model("ScrapeBatch", scrapeBatchSchema);
