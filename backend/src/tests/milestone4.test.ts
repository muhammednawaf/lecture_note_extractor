/**
 * Milestone 4 Test Suite:
 * - Page Relationship Classification (SAME_VIEW, CONTENT_CHANGE, SCROLL, PAN, ROTATION, NEW_PAGE, NEEDS_REVIEW)
 * - Temporal Page Identity Tracking Across History
 * - Return-to-Previous-Page Detection (Preventing False Duplicate Pages)
 * - Rich Page Segment Identification in ScrollDetectorService
 */

import assert from 'assert';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { PageRelationshipService } from '../services/pageRelationship.service.js';
import { PageIdentityTracker } from '../services/pageIdentity.service.js';
import { ScrollDetectorService } from '../services/scrollDetector.service.js';
import { UniqueCandidate } from '../services/duplicateDetector.service.js';
import { SimilarityAlgorithms } from '../algorithms/similarity.js';
import { OcrService } from '../services/ocr.service.js';
import { config } from '../core/config.js';

async function runMilestone4Tests() {
  console.log('====================================================');
  console.log('Running Milestone 4 Verification Tests');
  console.log('====================================================\n');

  let passedTests = 0;
  const testJobId = 'm4-test-' + Date.now();
  const testDir = path.join(config.framesDir, testJobId);
  fs.mkdirSync(testDir, { recursive: true });

  // Helper to build mock UniqueCandidate on disk
  const makeCandidate = async (
    name: string,
    svgContent: string,
    timestamp: number,
    ocrWords: string[] = []
  ): Promise<UniqueCandidate> => {
    const diskPath = path.join(testDir, `${name}.jpg`);
    const buf = await sharp(Buffer.from(svgContent)).jpeg({ quality: 95 }).toBuffer();
    fs.writeFileSync(diskPath, buf);

    const thumb = await sharp(buf)
      .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
      .grayscale()
      .raw()
      .toBuffer();

    const hash = await SimilarityAlgorithms.computeDHash(diskPath);

    return {
      frame: {
        id: `f-${name}`,
        jobId: testJobId,
        frameIndex: Math.round(timestamp),
        timestamp,
        imagePath: `frames/${testJobId}/${name}.jpg`,
        createdAt: new Date(),
      },
      absolutePath: diskPath,
      thumbnail: thumb,
      startTimestamp: timestamp,
      endTimestamp: timestamp + 1.0,
      qualityScore: 0.9,
      sharpness: 35.0,
      hashHex: hash.hashHex,
      hashBits: hash.binaryArray,
      ocrWords,
    };
  };

  // --- Test 1: Relationship Classification (SAME_VIEW, CONTENT_CHANGE, NEW_PAGE) ---
  console.log('[Test 1] PageRelationshipService: classification types...');
  const svgPage1 = '<svg width="640" height="360"><rect width="640" height="360" fill="white"/><text x="40" y="60" font-size="24" fill="black">Chapter 1: Limits</text></svg>';
  const cand1 = await makeCandidate('c1', svgPage1, 0.0, ['chapter', '1', 'limits']);

  // Identical view
  const relSame = await PageRelationshipService.classifyRelationship(cand1, cand1);
  assert.strictEqual(relSame.relationship, 'SAME_VIEW', 'Identical frames must be SAME_VIEW');

  // Same page, but new handwritten equation added (CONTENT_CHANGE)
  const svgPage1WithNotes = '<svg width="640" height="360"><rect width="640" height="360" fill="white"/><text x="40" y="60" font-size="24" fill="black">Chapter 1: Limits</text><text x="40" y="220" font-size="26" fill="blue">lim(x-&gt;0) sin(x)/x = 1</text></svg>';
  const cand1Notes = await makeCandidate('c1_notes', svgPage1WithNotes, 3.0, ['chapter', '1', 'limits', 'lim', 'sin', 'x', '=', '1']);
  const relContent = await PageRelationshipService.classifyRelationship(cand1, cand1Notes);
  assert.strictEqual(relContent.relationship, 'CONTENT_CHANGE', 'New equations added must be CONTENT_CHANGE');

  // Completely new slide (NEW_PAGE)
  const svgPage2 = '<svg width="640" height="360"><rect width="640" height="360" fill="#202020"/><text x="40" y="60" font-size="24" fill="white">Chapter 2: Derivatives</text></svg>';
  const cand2 = await makeCandidate('c2', svgPage2, 10.0, ['chapter', '2', 'derivatives']);
  const relNew = await PageRelationshipService.classifyRelationship(cand1, cand2);
  assert.strictEqual(relNew.relationship, 'NEW_PAGE', 'Completely different slide must be NEW_PAGE');
  console.log('  -> PASS: SAME_VIEW, CONTENT_CHANGE, and NEW_PAGE relationships classified accurately.\n');
  passedTests++;

  // --- Test 2: Horizontal Desk Camera Shift (PAN) ---
  console.log('[Test 2] Horizontal desk panning detection (PAN)...');
  const svgPan = '<svg width="640" height="360"><rect width="640" height="360" fill="white"/><text x="80" y="60" font-size="24" fill="black">Chapter 1: Limits</text></svg>'; // shifted 40px right
  const candPan = await makeCandidate('c_pan', svgPan, 4.0, ['chapter', '1', 'limits']);
  const relPan = await PageRelationshipService.classifyRelationship(cand1, candPan);
  assert.ok(['PAN', 'SAME_VIEW', 'CONTENT_CHANGE'].includes(relPan.relationship), 'Horizontal shift handled without false NEW_PAGE');
  console.log(`  -> PASS: Panning handled cleanly (classified as ${relPan.relationship}).\n`);
  passedTests++;

  // --- Test 3: Page Identity Tracking & Return-to-Previous-Page Detection ---
  console.log('[Test 3] PageIdentityTracker: return to earlier page...');
  const tracker = new PageIdentityTracker(10);

  // View Page 1
  const id1 = await tracker.assignIdentity(cand1);
  assert.strictEqual(id1.isReturnToPreviousPage, false);

  // Transition to Page 2
  const id2 = await tracker.assignIdentity(cand2);
  assert.strictEqual(id2.isReturnToPreviousPage, false);
  assert.notStrictEqual(id1.identityId, id2.identityId, 'Page 1 and Page 2 must have distinct identities');

  // Instructor returns to Page 1!
  const returnTo1 = await tracker.assignIdentity(cand1);
  console.log(`  [Diagnostic] returnTo1 identityId: ${returnTo1.identityId}, isReturnToPreviousPage: ${returnTo1.isReturnToPreviousPage}`);
  assert.strictEqual(returnTo1.isReturnToPreviousPage, true, 'Must detect return to earlier page');
  assert.strictEqual(returnTo1.identityId, id1.identityId, 'Must link back to Page 1 identity (prevents duplicate page creation!)');
  console.log('  -> PASS: Return-to-previous-page detected! Successfully linked to original logical page identity.\n');
  passedTests++;

  // --- Test 4: Rich Page Segment Identification in ScrollDetectorService ---
  console.log('[Test 4] ScrollDetectorService: segment grouping with identities...');
  const candidatesSequence = [cand1, cand1Notes, cand2];
  const segments = await ScrollDetectorService.identifyScrollSequences(candidatesSequence);

  assert.ok(segments.length >= 2, 'Must group into at least 2 logical page segments');
  assert.strictEqual(segments[0].candidates.length, 2, 'Page 1 initial and handwritten notes must be grouped together');
  console.log(`  -> PASS: Grouped ${candidatesSequence.length} candidates into ${segments.length} logical segments with provenance.\n`);
  passedTests++;

  // Cleanup test files
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  await OcrService.terminateWorker();

  console.log('====================================================');
  console.log(`Milestone 4 Test Suite Completed: ${passedTests} passed!`);
  console.log('====================================================');
  process.exit(0);
}

runMilestone4Tests().catch((err) => {
  console.error('\nMilestone 4 Test FAILED:', err);
  process.exit(1);
});

