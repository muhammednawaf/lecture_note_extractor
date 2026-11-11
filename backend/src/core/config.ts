import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Storage directory resolution (relative to backend root)
const ROOT_STORAGE_DIR = process.env.STORAGE_DIR 
  ? path.resolve(process.env.STORAGE_DIR)
  : path.resolve(__dirname, '../../storage');

const FRAMES_DIR = path.join(ROOT_STORAGE_DIR, 'frames');
const PAGES_DIR = path.join(ROOT_STORAGE_DIR, 'pages');
const PDFS_DIR = path.join(ROOT_STORAGE_DIR, 'pdfs');
const VIDEOS_DIR = path.join(ROOT_STORAGE_DIR, 'videos');
const TEMP_DIR = path.join(ROOT_STORAGE_DIR, 'temp');

// Ensure storage subdirectories exist
[ROOT_STORAGE_DIR, FRAMES_DIR, PAGES_DIR, PDFS_DIR, VIDEOS_DIR, TEMP_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

export const config = {
  port: parseInt(process.env.PORT || '8000', 10),
  host: process.env.HOST || '0.0.0.0',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/video2pdf',
  corsOrigins: process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
    : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'],
  storageDir: ROOT_STORAGE_DIR,
  framesDir: FRAMES_DIR,
  pagesDir: PAGES_DIR,
  pdfsDir: PDFS_DIR,
  videosDir: VIDEOS_DIR,
  tempDir: TEMP_DIR,
  maxFrameSizeBytes: 15 * 1024 * 1024, // 15MB
  retentionMs: parseInt(process.env.STORAGE_RETENTION_MS || '', 10) || 60 * 60 * 1000, // 1 hour default
  cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS || '', 10) || 10 * 60 * 1000, // 10 minutes default
};
