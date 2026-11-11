/**
 * Milestone 5 Test Suite:
 * - ZoomIntegrationService: Geometric verification & detail integration (SSIM >= 0.82)
 * - ZoomIntegrationService: Uncertain zoom fallback (SSIM < 0.82) preserving distinct page
 * - PageStitcherService: Integrated zoom detail into base page without duplicate page creation
 * - PageStitcherService: Preserves unaligned zoom frames as distinct pages marked NEEDS_REVIEW
 * - PageStitcherService: Seamless vertical stitching for multi-frame scrolling documents
 * - PageStitcherService: Safe fallback on runaway / excessive stitching (preserving individual frames)
 */

import assert from 'assert';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { ZoomIntegrationService } from '../services/zoomIntegration.service.js';
import { PageStitcherService } from '../services/pageStitcher.service.js';
import { PageSegment } from '../services/scrollDetector.service.js';
import { UniqueCandidate } from '../services/duplicateDetector.service.js';
import { config } from '../core/config.js';

async function runMilestone5Tests() {
  console.log('====================================================');
  console.log('Running Milestone 5 Verification Tests');
  console.log('====================================================\n');

  let passedTests = 0;
  const testJobId = 'm5-test-' + Date.now();
  const testDir = path.join(config.framesDir, testJobId);
  fs.mkdirSync(testDir, { recursive: true });

  const makeMockCandidate = async (
    name: string,
    imageBuffer: Buffer,
    timestamp: number
  ): Promise<UniqueCandidate> => {
    const diskPath = path.join(testDir, `${name}.jpg`);
    fs.writeFileSync(diskPath, imageBuffer);

    const thumb = await sharp(imageBuffer)
      .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
      .grayscale()
      .raw()
      .toBuffer();

    return {
      frame: {
        id: `frame-${name}`,
        jobId: testJobId,
        frameIndex: Math.round(timestamp),
        timestamp,
        imagePath: `frames/${testJobId}/${name}.jpg`,
        createdAt: new Date(),
      },
      absolutePath: diskPath,
      thumbnail: thumb,
      hashHex: '0000000000000000',
      hashBits: new Array(64).fill(0),
      qualityScore: 0.95,
      sharpness: 100,
      startTimestamp: timestamp,
      endTimestamp: timestamp + 2,
    };
  };

  // Base canvas with structured lecture content
  const baseSvg = `
    <svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
      <rect width="640" height="360" fill="#fdfbf7"/>
      <text x="40" y="50" font-family="monospace" font-size="24" fill="#111">Lecture: Calculus of Variations</text>
      <line x1="40" y1="65" x2="600" y2="65" stroke="#333" stroke-width="2"/>
      <!-- Center equation section -->
      <rect x="128" y="72" width="384" height="216" fill="#f0f4f8" stroke="#0066cc" stroke-width="2"/>
      <text x="160" y="140" font-family="serif" font-size="28" fill="#003366">J[y] = int_a^b L(x, y, y') dx</text>
      <text x="160" y="200" font-family="serif" font-size="28" fill="#003366">dL/dy - d/dx(dL/dy') = 0</text>
      <!-- Bottom footer -->
      <text x="40" y="330" font-family="sans-serif" font-size="16" fill="#555">Theorem 1.1: Euler-Lagrange Extremals</text>
    </svg>
  `;
  const baseBuffer = await sharp(Buffer.from(baseSvg)).jpeg({ quality: 95 }).toBuffer();

  // ----------------------------------------------------
  // Test 1: Verified Zoom Detail Integration (SSIM >= 0.82)
  // ----------------------------------------------------
  console.log('Test 1: ZoomIntegrationService aligns and verifies high-res zoom detail...');
  // Zoom into the center equation box (x: 128, y: 72, w: 384, h: 216 -> 60% of base)
  const zoomCropBuffer = await sharp(baseBuffer)
    .extract({ left: 128, top: 72, width: 384, height: 216 })
    .resize(640, 360)
    .jpeg({ quality: 95 })
    .toBuffer();

  const zoomResult = await ZoomIntegrationService.integrateZoom(baseBuffer, zoomCropBuffer);

  assert.strictEqual(zoomResult.isIntegrated, true, 'Zoom detail should be recognized and integrated');
  assert.ok(zoomResult.confidence >= 0.82, `Confidence ${zoomResult.confidence} should be >= 0.82`);
  assert.ok(zoomResult.matchedRegion !== undefined, 'Matched region coordinates should be populated');
  assert.ok(zoomResult.resultBuffer.length > 0, 'Composite buffer should be generated');
  console.log(`  ✓ Zoom verified with confidence ${zoomResult.confidence} at region [${zoomResult.matchedRegion?.left}, ${zoomResult.matchedRegion?.top}, ${zoomResult.matchedRegion?.width}x${zoomResult.matchedRegion?.height}]`);
  passedTests++;

  // ----------------------------------------------------
  // Test 2: Uncertain Zoom Detail Preserved (SSIM < 0.82)
  // ----------------------------------------------------
  console.log('\nTest 2: ZoomIntegrationService rejects unaligned / unrelated zoom detail...');
  const unrelatedSvg = `
    <svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
      <rect width="640" height="360" fill="#000000"/>
      <circle cx="320" cy="180" r="100" fill="#ff0000"/>
      <text x="150" y="190" font-family="sans-serif" font-size="32" fill="#fff">Completely Different</text>
    </svg>
  `;
  const unrelatedBuffer = await sharp(Buffer.from(unrelatedSvg)).jpeg({ quality: 95 }).toBuffer();

  const unalignedResult = await ZoomIntegrationService.integrateZoom(baseBuffer, unrelatedBuffer);
  assert.strictEqual(unalignedResult.isIntegrated, false, 'Unrelated image should NOT be integrated');
  assert.ok(unalignedResult.confidence < 0.82, `Confidence ${unalignedResult.confidence} should be < 0.82`);
  assert.ok(
    unalignedResult.warnings.some((w) => w.includes('Zoom geometric alignment uncertain')),
    'Warning should flag uncertain geometric alignment'
  );
  console.log(`  ✓ Unaligned zoom safely rejected (confidence: ${unalignedResult.confidence}) with review warning`);
  passedTests++;

  // ----------------------------------------------------
  // Test 3: PageStitcherService integrates ZOOM_DETAIL into base page
  // ----------------------------------------------------
  console.log('\nTest 3: PageStitcherService integrates ZOOM_DETAIL without duplicate page creation...');
  const candBase = await makeMockCandidate('base1', baseBuffer, 10.0);
  const candZoom = await makeMockCandidate('zoom1', zoomCropBuffer, 14.0);

  const segmentBase: PageSegment = {
    type: 'STATIC_PAGE',
    candidates: [candBase],
    shifts: [0],
    startTimestamp: 10.0,
    endTimestamp: 13.0,
    confidence: 1.0,
    pageIdentityId: 'page-identity-1',
    relationship: 'SAME_VIEW',
    warnings: [],
  };

  const segmentZoom: PageSegment = {
    type: 'ZOOM_DETAIL',
    candidates: [candZoom],
    shifts: [0],
    startTimestamp: 14.0,
    endTimestamp: 20.0,
    confidence: 0.95,
    pageIdentityId: 'page-identity-1',
    relationship: 'ZOOM',
    warnings: ['Camera zoomed in on equation derivation'],
  };

  const reconstructed = await PageStitcherService.reconstructPages([segmentBase, segmentZoom]);

  assert.strictEqual(reconstructed.length, 1, 'Should produce 1 consolidated page instead of duplicate pages');
  assert.strictEqual(reconstructed[0].endTimestamp, 20.0, 'End timestamp should be extended to include zoom segment');
  assert.strictEqual(reconstructed[0].sourceFrameIds.length, 2, 'Provenance should track both source frames');
  assert.strictEqual(reconstructed[0].reconstructionStatus, 'VERIFIED', 'Integrated page should be VERIFIED');
  console.log(`  ✓ 1 consolidated page produced, tracking source frames [${reconstructed[0].sourceFrameIds.join(', ')}] through timestamp ${reconstructed[0].endTimestamp}s`);
  passedTests++;

  // ----------------------------------------------------
  // Test 4: PageStitcherService preserves unaligned ZOOM_DETAIL as separate page
  // ----------------------------------------------------
  console.log('\nTest 4: PageStitcherService preserves unaligned ZOOM_DETAIL as separate NEEDS_REVIEW page...');
  const candUnrelated = await makeMockCandidate('unrelated1', unrelatedBuffer, 22.0);

  const segmentUnalignedZoom: PageSegment = {
    type: 'ZOOM_DETAIL',
    candidates: [candUnrelated],
    shifts: [0],
    startTimestamp: 22.0,
    endTimestamp: 26.0,
    confidence: 0.90,
    pageIdentityId: 'page-identity-1',
    relationship: 'ZOOM',
    warnings: [],
  };

  const fallbackPages = await PageStitcherService.reconstructPages([segmentBase, segmentUnalignedZoom]);

  assert.strictEqual(fallbackPages.length, 2, 'Should preserve both base page and unaligned zoom frame');
  assert.strictEqual(fallbackPages[0].reconstructionStatus, 'VERIFIED', 'Base page should be VERIFIED');
  assert.strictEqual(fallbackPages[1].reconstructionStatus, 'NEEDS_REVIEW', 'Unaligned zoom frame must be marked NEEDS_REVIEW');
  assert.ok(
    fallbackPages[1].warnings.some((w) => w.includes('Zoom geometric alignment uncertain')),
    'Unaligned zoom should carry review warning'
  );
  console.log(`  ✓ 2 pages preserved; zoom page marked [${fallbackPages[1].reconstructionStatus}] with warning: "${fallbackPages[1].warnings[0]}"`);
  passedTests++;

  // ----------------------------------------------------
  // Test 5: Safe vertical scrolling reconstruction
  // ----------------------------------------------------
  console.log('\nTest 5: PageStitcherService reconstructs scrolling document sequences...');
  const docSlice1Svg = `
    <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="300" fill="#ffffff"/>
      <text x="20" y="40" font-family="sans-serif" font-size="20" fill="#000">Chapter 1: Functions</text>
      <text x="20" y="100" font-family="sans-serif" font-size="16" fill="#222">Line 1: f(x) = x^2</text>
      <text x="20" y="180" font-family="sans-serif" font-size="16" fill="#222">Line 2: g(x) = sin(x)</text>
      <text x="20" y="260" font-family="sans-serif" font-size="16" fill="#222">Line 3: Overlapping Line</text>
    </svg>
  `;
  const docSlice2Svg = `
    <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="300" fill="#ffffff"/>
      <text x="20" y="180" font-family="sans-serif" font-size="16" fill="#222">Line 3: Overlapping Line</text>
      <text x="20" y="240" font-family="sans-serif" font-size="16" fill="#222">Line 4: h(x) = e^x</text>
      <text x="20" y="290" font-family="sans-serif" font-size="16" fill="#222">Line 5: Integral Section</text>
    </svg>
  `;
  const bufSlice1 = await sharp(Buffer.from(docSlice1Svg)).jpeg().toBuffer();
  const bufSlice2 = await sharp(Buffer.from(docSlice2Svg)).jpeg().toBuffer();

  const candSlice1 = await makeMockCandidate('slice1', bufSlice1, 30.0);
  const candSlice2 = await makeMockCandidate('slice2', bufSlice2, 33.0);

  const scrollSegment: PageSegment = {
    type: 'SCROLLING_PAGE',
    candidates: [candSlice1, candSlice2],
    shifts: [0, 80],
    startTimestamp: 30.0,
    endTimestamp: 35.0,
    confidence: 0.95,
    pageIdentityId: 'page-doc-1',
    relationship: 'SCROLL',
    warnings: [],
  };

  const scrollPages = await PageStitcherService.reconstructPages([scrollSegment]);
  assert.strictEqual(scrollPages.length, 1, 'Scrolling sequence should be stitched into 1 page');
  assert.strictEqual(scrollPages[0].isStitched, true, 'isStitched should be true');
  assert.strictEqual(scrollPages[0].reconstructionStatus, 'VERIFIED');
  assert.strictEqual(scrollPages[0].sourceFrameIds.length, 2, 'Should record both source candidate frames');

  const stitchedMeta = await sharp(scrollPages[0].imageBuffer).metadata();
  assert.strictEqual(stitchedMeta.height, 300 + 80, `Stitched height should be 380px, got ${stitchedMeta.height}`);
  console.log(`  ✓ Stitched into 1 complete page of height ${stitchedMeta.height}px with status VERIFIED`);
  passedTests++;

  // ----------------------------------------------------
  // Test 6: Safe fallback on runaway stitch limit (> 6000px)
  // ----------------------------------------------------
  console.log('\nTest 6: PageStitcherService falls back safely when stitching exceeds safety limits...');
  const excessiveShiftSegment: PageSegment = {
    type: 'SCROLLING_PAGE',
    candidates: [candSlice1, candSlice2],
    shifts: [0, 6200], // shift exceeds 6,000px threshold
    startTimestamp: 40.0,
    endTimestamp: 45.0,
    confidence: 0.80,
    pageIdentityId: 'page-doc-runaway',
    relationship: 'SCROLL',
    warnings: [],
  };

  const safeFallbackPages = await PageStitcherService.reconstructPages([excessiveShiftSegment]);

  assert.strictEqual(safeFallbackPages.length, 2, 'Should fall back to preserving both candidate frames individually');
  assert.strictEqual(safeFallbackPages[0].reconstructionStatus, 'NEEDS_REVIEW');
  assert.strictEqual(safeFallbackPages[1].reconstructionStatus, 'NEEDS_REVIEW');
  assert.ok(
    safeFallbackPages[0].warnings.some((w) => w.includes('Stitching uncertain')),
    'Candidate frame should carry stitching fallback warning'
  );
  console.log(`  ✓ Safely caught runaway stitch: preserved ${safeFallbackPages.length} individual frames marked NEEDS_REVIEW without crashing`);
  passedTests++;

  // Cleanup test fixtures
  fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n====================================================');
  console.log(`Milestone 5 Results: ${passedTests}/6 tests PASSED`);
  console.log('====================================================\n');
}

runMilestone5Tests().catch((err) => {
  console.error('Milestone 5 Test Failed:', err);
  process.exit(1);
});
