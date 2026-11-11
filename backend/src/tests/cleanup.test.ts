/**
 * Storage Cleanup & 15-Minute Retention Automated Test Suite
 * Verifies automatic deletion of stored frames, pages, PDFs, and videos
 * older than the retention threshold (15 minutes), and preservation of active assets.
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../core/config.js';
import { StorageCleanupService } from '../services/storageCleanup.service.js';
import { JobRepository } from '../models/Job.model.js';
import { FrameRepository } from '../models/Frame.model.js';
import { PageRepository } from '../models/Page.model.js';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

async function runStorageCleanupTests() {
  console.log('====================================================');
  console.log('Running Storage Cleanup & 15-Minute Retention Tests');
  console.log('====================================================\n');

  // Ensure directories exist
  [config.framesDir, config.pagesDir, config.pdfsDir, config.videosDir, config.tempDir].forEach(
    (d) => fs.mkdirSync(d, { recursive: true })
  );

  // ─── Test 1: File & Directory Purge of Expired Assets ──────────────────────
  console.log('Test 1: StorageCleanupService deletes expired frames, pages, pdfs, videos...');
  const expiredJobId = uuidv4();
  const activeJobId = uuidv4();

  // Create expired assets
  const expiredFrameDir = path.join(config.framesDir, expiredJobId);
  fs.mkdirSync(expiredFrameDir, { recursive: true });
  fs.writeFileSync(path.join(expiredFrameDir, 'frame_00001.jpg'), 'fake-frame-content');

  const expiredPageDir = path.join(config.pagesDir, expiredJobId);
  fs.mkdirSync(expiredPageDir, { recursive: true });
  fs.writeFileSync(path.join(expiredPageDir, 'page_001.jpg'), 'fake-page-content');

  const expiredVideoDir = path.join(config.videosDir, expiredJobId);
  fs.mkdirSync(expiredVideoDir, { recursive: true });
  fs.writeFileSync(path.join(expiredVideoDir, 'video.mp4'), 'fake-video-content');

  const expiredPdfDir = path.join(config.pdfsDir, expiredJobId);
  fs.mkdirSync(expiredPdfDir, { recursive: true });
  fs.writeFileSync(path.join(expiredPdfDir, 'lecture.pdf'), 'fake-pdf-content');

  // Create active assets
  const activeFrameDir = path.join(config.framesDir, activeJobId);
  fs.mkdirSync(activeFrameDir, { recursive: true });
  fs.writeFileSync(path.join(activeFrameDir, 'frame_00001.jpg'), 'active-frame-content');

  const activePageDir = path.join(config.pagesDir, activeJobId);
  fs.mkdirSync(activePageDir, { recursive: true });
  fs.writeFileSync(path.join(activePageDir, 'page_001.jpg'), 'active-page-content');

  // Artificial aging: set mtime of expired assets to 20 minutes ago (1200 seconds ago)
  const twentyMinsAgo = (Date.now() - 1200 * 1000) / 1000;
  fs.utimesSync(expiredFrameDir, twentyMinsAgo, twentyMinsAgo);
  fs.utimesSync(expiredPageDir, twentyMinsAgo, twentyMinsAgo);
  fs.utimesSync(expiredVideoDir, twentyMinsAgo, twentyMinsAgo);
  fs.utimesSync(expiredPdfDir, twentyMinsAgo, twentyMinsAgo);

  // Run cleanup with 15-minute retention (15 * 60 * 1000 ms)
  const result1 = await StorageCleanupService.runCleanup(15 * 60 * 1000);

  // Assert expired directories were removed
  assert(!fs.existsSync(expiredFrameDir), 'Expired frame directory should have been deleted');
  assert(!fs.existsSync(expiredPageDir), 'Expired page directory should have been deleted');
  assert(!fs.existsSync(expiredVideoDir), 'Expired video directory should have been deleted');
  assert(!fs.existsSync(expiredPdfDir), 'Expired pdf directory should have been deleted');

  // Assert active assets were preserved
  assert(fs.existsSync(activeFrameDir), 'Active frame directory must be preserved');
  assert(fs.existsSync(activePageDir), 'Active page directory must be preserved');

  console.log(`  ✓ Successfully deleted expired assets; active assets preserved (${result1.dirsDeleted} dirs removed)`);

  // Cleanup active test dirs
  try {
    fs.rmSync(activeFrameDir, { recursive: true, force: true });
    fs.rmSync(activePageDir, { recursive: true, force: true });
  } catch {}

  // ─── Test 2: Database Record Cleanup for Expired Jobs ─────────────────────
  console.log('\nTest 2: Database records for expired jobs are automatically purged...');
  const oldJobId = uuidv4();
  const recentJobId = uuidv4();

  // Create old job with backdated createdAt (20 minutes ago)
  const oldJob = await JobRepository.create({
    id: oldJobId,
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    videoTitle: 'Ancient Lecture',
    sourceType: 'YOUTUBE',
    status: 'COMPLETED',
    totalFrames: 10,
    totalPages: 2,
    createdAt: new Date(Date.now() - 1200 * 1000), // 20 mins ago
  });

  await FrameRepository.create({
    jobId: oldJob.id,
    frameIndex: 0,
    timestamp: 0,
    imagePath: `frames/${oldJob.id}/frame_00000_0.00s.jpg`,
  });

  await PageRepository.create({
    jobId: oldJob.id,
    pageNumber: 1,
    imagePath: `pages/${oldJob.id}/page_001.jpg`,
    startTimestamp: 0,
    endTimestamp: 5,
    qualityScore: 0.9,
    confidence: 0.95,
    rotation: 0,
    isEdited: false,
    sourceFrameIds: ['f-1'],
    reconstructionStatus: 'VERIFIED',
    warnings: [],
  });

  // Create recent job
  const recentJob = await JobRepository.create({
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    videoTitle: 'Fresh Lecture',
    sourceType: 'YOUTUBE',
    status: 'COMPLETED',
    totalFrames: 5,
    totalPages: 1,
  });

  // Run cleanup with 15-minute threshold
  await StorageCleanupService.runCleanup(15 * 60 * 1000);

  // Assert old job was deleted
  const foundOldJob = await JobRepository.findById(oldJob.id);
  assert(foundOldJob === null, 'Old job should have been deleted from repository');

  const oldFrames = await FrameRepository.findByJobId(oldJob.id);
  assert(oldFrames.length === 0, 'Frames of old job should have been purged');

  const oldPages = await PageRepository.findByJobId(oldJob.id);
  assert(oldPages.length === 0, 'Pages of old job should have been purged');

  // Assert recent job was preserved
  const foundRecentJob = await JobRepository.findById(recentJob.id);
  assert(foundRecentJob !== null, 'Recent job must be preserved');

  console.log('  ✓ Expired job and its frames/pages purged cleanly from persistence');

  // ─── Test 3: Standalone PDF and Temp Upload File Cleanup ──────────────────
  console.log('\nTest 3: Standalone PDF files and abandoned temp uploads are purged...');
  const tempFile = path.join(config.tempDir, `orphan-${Date.now()}.mp4`);
  const oldPdfFile = path.join(config.pdfsDir, `orphan-${Date.now()}.pdf`);
  const freshPdfFile = path.join(config.pdfsDir, `fresh-${Date.now()}.pdf`);

  fs.writeFileSync(tempFile, 'abandoned-upload-chunk');
  fs.writeFileSync(oldPdfFile, 'ancient-pdf-data');
  fs.writeFileSync(freshPdfFile, 'fresh-pdf-data');

  fs.utimesSync(tempFile, twentyMinsAgo, twentyMinsAgo);
  fs.utimesSync(oldPdfFile, twentyMinsAgo, twentyMinsAgo);

  await StorageCleanupService.runCleanup(15 * 60 * 1000);

  assert(!fs.existsSync(tempFile), 'Abandoned temp file should be deleted');
  assert(!fs.existsSync(oldPdfFile), 'Ancient standalone PDF should be deleted');
  assert(fs.existsSync(freshPdfFile), 'Fresh PDF file should be preserved');

  console.log('  ✓ Standalone PDFs and temp uploads cleaned up correctly');

  // Clean up fresh test file
  try {
    fs.unlinkSync(freshPdfFile);
  } catch {}

  console.log('\n====================================================');
  console.log('Storage Cleanup Test Suite: 3/3 tests PASSED!');
  console.log('====================================================\n');
}

runStorageCleanupTests().catch((err) => {
  console.error('Storage Cleanup Test Failed:', err);
  process.exit(1);
});
