import mongoose from 'mongoose';
import { config } from '../core/config.js';

let isMongoConnected = false;

export async function connectDB(): Promise<boolean> {
  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 3000, // Quick timeout for local fallback
    });
    isMongoConnected = true;
    console.log(`[Database] Successfully connected to MongoDB at: ${config.mongodbUri}`);
    return true;
  } catch (error: any) {
    console.warn(`[Database] MongoDB connection failed (${error.message}). Running with resilient memory/file fallback.`);
    isMongoConnected = false;
    return false;
  }
}

export function getIsMongoConnected(): boolean {
  return isMongoConnected;
}

