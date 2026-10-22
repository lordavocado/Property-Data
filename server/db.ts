// MongoDB connection setup. Reads MONGODB_URI from the environment; falls back
// to a local database for development.
import mongoose from "mongoose";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/homeharvest";

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGODB_URI || DEFAULT_URI;
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log(`[db] connected to ${uri.replace(/\/\/[^@]+@/, "//***@")}`);
}
