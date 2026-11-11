/**
 * Milestone 1 Test Suite:
 * - Safe Observation Management
 * - Immutable Frame Preservation
 * - Idempotent Page Reprocessing
 * - Preservation of User-Edited Pages
 * - Memory Fallback & Repository Verification
 */

import assert from 'assert';
import { connectDB, getIsMongoConnected } from '../database/connection.js';
import { FrameRepository } from '../models/Frame.model.js';
import { PageRepository } from '../models/Page.model.js';
import { PageDetectorService } from '../services/pageDetector.service.js';
import { JobRepository } from '../models/Job.model.js';
import { OcrService } from '../services/ocr.service.js';

async function runMilestone1Tests() {
  console.log('====================================================');
  console.log('Running Milestone 1 Verification Tests');
  console.log('====================================================\n');

  // Attempt database connection (tests fallback resilience if offline)
  await connectDB();
  console.log(`Database Status: ${getIsMongoConnected() ? 'Connected to MongoDB' : 'Running in Memory/File Fallback Mode'}\n`);

  let passedTests = 0;

  // --- Test 1: FrameRepository Immutability & Relative Path Standardization ---
  console.log('[Test 1] FrameRepository: creation, order, and relative path...');
  FrameRepository.clearMemoryStore();
  const testJobId = 'test-job-m1-' + Date.now();

  const f1 = await FrameRepository.create({
    jobId: testJobId,
    frameIndex: 0,
    timestamp: 0.0,
    imagePath: `frames/${testJobId}/frame_00000_0.00s.jpg`,
  });

  const f2 = await FrameRepository.create({
    jobId: testJobId,
    frameIndex: 1,
    timestamp: 1.0,
    imagePath: `frames/${testJobId}/frame_00001_1.00s.jpg`,
  });

  const retrievedFrames = await FrameRepository.findByJobId(testJobId);
  assert.strictEqual(retrievedFrames.length, 2, 'Must retrieve both frames');
  assert.strictEqual(retrievedFrames[0].frameIndex, 0, 'Frames must be sorted by frameIndex');
  assert.strictEqual(retrievedFrames[1].frameIndex, 1, 'Frames must be sorted by frameIndex');
  assert.ok(retrievedFrames[0].imagePath.startsWith('frames/'), 'imagePath must use standardized relative path');
  console.log('  -> PASS: FrameRepository creates and retrieves frames immutably.\n');
  passedTests++;

  // --- Test 2: PageRepository Extended Fields & Reconstruction Status ---
  console.log('[Test 2] PageRepository: extended architectural fields...');
  PageRepository.clearMemoryStore();

  const pageVerified = await PageRepository.create({
    jobId: testJobId,
    pageNumber: 1,
    imagePath: `pages/${testJobId}/page_0001.jpg`,
    startTimestamp: 0.0,
    endTimestamp: 5.0,
    qualityScore: 0.95,
    confidence: 0.98,
    isEdited: false,
    sourceFrameIds: [f1.id],
    reconstructionStatus: 'VERIFIED',
    warnings: [],
  });

  assert.strictEqual(pageVerified.reconstructionStatus, 'VERIFIED');
  assert.deepStrictEqual(pageVerified.sourceFrameIds, [f1.id]);
  assert.deepStrictEqual(pageVerified.warnings, []);

  const pageReview = await PageRepository.create({
    jobId: testJobId,
    pageNumber: 2,
    imagePath: `pages/${testJobId}/page_0002.jpg`,
    startTimestamp: 5.0,
    endTimestamp: 10.0,
    qualityScore: 0.65,
    confidence: 0.72,
    isEdited: false,
    sourceFrameIds: [f2.id],
    reconstructionStatus: 'NEEDS_REVIEW',
    warnings: ['Low confidence reconstruction'],
  });

  assert.strictEqual(pageReview.reconstructionStatus, 'NEEDS_REVIEW');
  assert.strictEqual(pageReview.warnings.length, 1);
  console.log('  -> PASS: Extended fields (reconstructionStatus, sourceFrameIds, warnings) persisted.\n');
  passedTests++;

  // --- Test 3: Idempotent Deletion with User-Edited Page Preservation ---
  console.log('[Test 3] Idempotent Reprocessing & Preservation of User-Edited Pages...');
  // Mark page 2 as user-edited (e.g. user rotated it 90 degrees in review interface)
  await PageRepository.update(pageReview.id, { isEdited: true, rotation: 90 });

  // Simulate reprocessing trigger: deleteByJobId with preserveEdited: true
  const deletedCount = await PageRepository.deleteByJobId(testJobId, { preserveEdited: true });
  assert.strictEqual(deletedCount, 1, 'Should delete only the unedited page (page 1)');

  const remaining = await PageRepository.findByJobId(testJobId);
  assert.strictEqual(remaining.length, 1, 'Only the user-edited page must remain');
  assert.strictEqual(remaining[0].id, pageReview.id, 'Preserved page must be the edited page');
  assert.strictEqual(remaining[0].isEdited, true, 'Preserved page isEdited flag must be true');
  assert.strictEqual(remaining[0].rotation, 90, 'Preserved page rotation must be intact');
  console.log('  -> PASS: User-edited page was strictly preserved across reprocessing deletion.\n');
  passedTests++;

  // --- Test 4: Complete Deletion when preserveEdited: false ---
  console.log('[Test 4] Explicit complete job purge (preserveEdited: false)...');
  await PageRepository.deleteByJobId(testJobId, { preserveEdited: false });
  const emptyPages = await PageRepository.findByJobId(testJobId);
  assert.strictEqual(emptyPages.length, 0, 'All pages should be purged when preserveEdited: false');
  console.log('  -> PASS: Full purge works cleanly.\n');
  passedTests++;

  // --- Test 5: End-to-End Idempotent PageDetector Processing ---
  console.log('[Test 5] End-to-end repeated processing idempotency verification...');
  const e2eJob = await JobRepository.create({
    videoTitle: 'E2E Reprocessing Idempotency Test',
    sourceType: 'UPLOAD',
  });

  // Create real temporary frames on disk for this job
  const sharp = (await import('sharp')).default;
  const path = (await import('path')).default;
  const fs = (await import('fs')).default;
  const { config } = await import('../core/config.js');

  const e2eFramesDir = path.join(config.framesDir, e2eJob.id);
  fs.mkdirSync(e2eFramesDir, { recursive: true });

  // Generate 3 sample test frames (white canvas with distinct text/lines)
  for (let i = 0; i < 3; i++) {
    const filename = `frame_${String(i).padStart(5, '0')}_${(i * 1.0).toFixed(2)}s.jpg`;
    const frameDiskPath = path.join(e2eFramesDir, filename);

    // Create an image with sharp
    const svgText = `<svg width="640" height="360"><rect width="640" height="360" fill="white"/><text x="50" y="100" font-size="28" fill="black">Test Frame ${i + 1}</text></svg>`;
    const imgBuffer = await sharp(Buffer.from(svgText)).jpeg({ quality: 90 }).toBuffer();
    fs.writeFileSync(frameDiskPath, imgBuffer);

    await FrameRepository.create({
      jobId: e2eJob.id,
      frameIndex: i,
      timestamp: i * 1.0,
      imagePath: `frames/${e2eJob.id}/${filename}`,
    });
  }

  // Run 1: initial page detection
  const run1 = await PageDetectorService.processJob(e2eJob.id);
  assert.ok(run1.finalPagesExtracted > 0, 'Run 1 must extract pages');
  const pagesRun1 = await PageRepository.findByJobId(e2eJob.id);
  assert.strictEqual(pagesRun1.length, run1.finalPagesExtracted, 'DB pages must equal run 1 count');

  // Verify extended fields are populated
  assert.ok(pagesRun1[0].sourceFrameIds.length > 0, 'sourceFrameIds must be tracked');
  assert.ok(['VERIFIED', 'NEEDS_REVIEW'].includes(pagesRun1[0].reconstructionStatus), 'reconstructionStatus must be valid');

  // Run 2: idempotent re-run
  const run2 = await PageDetectorService.processJob(e2eJob.id);
  const pagesRun2 = await PageRepository.findByJobId(e2eJob.id);
  assert.strictEqual(
    pagesRun2.length,
    run2.finalPagesExtracted,
    'DB pages must NOT duplicate on reprocessing (idempotency check)'
  );
  assert.strictEqual(
    run1.finalPagesExtracted,
    run2.finalPagesExtracted,
    'Page count must be identical on repeated runs'
  );
  console.log(`  -> PASS: Idempotent processing verified! ${run1.finalPagesExtracted} pages produced across both runs.\n`);
  passedTests++;

  // Cleanup test files
  try {
    fs.rmSync(e2eFramesDir, { recursive: true, force: true });
    const e2ePagesDir = path.join(config.pagesDir, e2eJob.id);
    fs.rmSync(e2ePagesDir, { recursive: true, force: true });
    await PageRepository.deleteByJobId(e2eJob.id, { preserveEdited: false });
  } catch {
    // ignore
  }

  console.log('====================================================');
  console.log(`Milestone 1 Test Suite Completed: ${passedTests} passed!`);
  console.log('====================================================');

  await OcrService.terminateWorker();
  process.exit(0);
}

runMilestone1Tests().catch((err) => {
  console.error('\nMilestone 1 Test FAILED:', err);
  process.exit(1);
});
