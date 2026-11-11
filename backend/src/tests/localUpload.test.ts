/**
 * Local Video Upload & Frame Extraction Verification Suite
 * Tests uploading a local video file (multipart/form-data),
 * saving to storage, and extracting frames via ffmpeg without HTTP 500 errors.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { JobRepository } from '../models/Job.model.js';
import { FrameRepository } from '../models/Frame.model.js';
import { VideoDownloaderService } from '../services/videoDownloader.service.js';
import { FrameExtractorService } from '../services/frameExtractor.service.js';
import { config } from '../core/config.js';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

async function runLocalUploadTest() {
  console.log('====================================================');
  console.log('Running Local Video Upload & Extraction Test');
  console.log('====================================================\n');

  if (!fs.existsSync(config.tempDir)) {
    fs.mkdirSync(config.tempDir, { recursive: true });
  }

  const testVideoPath = path.join(config.tempDir, 'test_lecture.mp4');
  if (!fs.existsSync(testVideoPath)) {
    try {
      execSync(`ffmpeg -y -f lavfi -i color=c=blue:s=320x240:d=1 -c:v libx264 "${testVideoPath}" 2>/dev/null`);
    } catch {
      // If ffmpeg CLI not directly in path, create minimal test buffer
      fs.writeFileSync(testVideoPath, Buffer.alloc(1024));
    }
  }

  // 1. Create upload job
  const job = await JobRepository.create({
    videoTitle: 'Test Local Lecture',
    sourceType: 'UPLOAD',
  });
  console.log(`Created test upload job: ${job.id}`);
  assert(job.sourceType === 'UPLOAD', 'Job sourceType must be UPLOAD');

  // 2. Test saving uploaded video file (disk stream simulation)
  console.log('Test 1: Saving uploaded video to job storage...');
  const savedPath = VideoDownloaderService.saveUploadedVideo(
    job.id,
    testVideoPath,
    'lecture_recording.mp4'
  );
  assert(fs.existsSync(savedPath), `Saved video must exist at ${savedPath}`);
  console.log(`  ✓ Video saved cleanly to: ${savedPath}`);

  // 3. Test frame extraction from local video
  console.log('\nTest 2: Extracting frames via ffmpeg from uploaded video...');
  const extraction = await FrameExtractorService.extractFramesFromVideo(
    savedPath,
    job.id,
    1
  );

  console.log(`  ✓ Extracted ${extraction.totalFrames} frames from local video.`);
  assert(extraction.totalFrames > 0, 'Must extract at least 1 frame');

  // 4. Verify FrameRepository created records
  const frames = await FrameRepository.findByJobId(job.id);
  assert(frames.length === extraction.totalFrames, `Frame count mismatch: ${frames.length} vs ${extraction.totalFrames}`);
  console.log(`  ✓ Persisted ${frames.length} captured frames in repository.`);

  // Cleanup test job storage
  const jobVideosDir = path.join(config.videosDir, job.id);
  const jobFramesDir = path.join(config.framesDir, job.id);
  try {
    fs.rmSync(jobVideosDir, { recursive: true, force: true });
    fs.rmSync(jobFramesDir, { recursive: true, force: true });
  } catch {}

  console.log('\n====================================================');
  console.log('Local Video Upload Test: ALL TESTS PASSED!');
  console.log('====================================================\n');
}

runLocalUploadTest().catch((err) => {
  console.error('Local Upload Test Failed:', err);
  process.exit(1);
});

