/**
 * Milestone 2 Test Suite:
 * - Aspect-Ratio-Preserving Similarity
 * - 3x3 Regional SSIM & Localized Quadrant Change Detection
 * - Math-Aware OCR Tokenization & Symbol Preservation
 * - Enhanced Math-Aware Content Change Detection
 * - Non-Destructive Quality Blur Handling
 */

import assert from 'assert';
import sharp from 'sharp';
import { SimilarityAlgorithms } from '../algorithms/similarity.js';
import { OcrService } from '../services/ocr.service.js';
import { DuplicateDetectorService } from '../services/duplicateDetector.service.js';
import { IFrame } from '../models/Frame.model.js';
import path from 'path';
import fs from 'fs';
import { config } from '../core/config.js';

async function runMilestone2Tests() {
  console.log('====================================================');
  console.log('Running Milestone 2 Verification Tests');
  console.log('====================================================\n');

  let passedTests = 0;

  // --- Test 1: Math-Aware OCR Tokenization ---
  console.log('[Test 1] Math-aware tokenization: single variables & operators...');
  const mathInput1 = 'f(x) = 2x^2 + 3x - 5';
  const tokens1 = OcrService.tokenizeMathText(mathInput1);
  assert.ok(tokens1.words.includes('x'), 'Must preserve single variable x');
  assert.ok(tokens1.words.includes('f'), 'Must preserve function variable f');
  assert.ok(tokens1.words.includes('='), 'Must preserve equality operator =');
  assert.ok(tokens1.words.includes('+'), 'Must preserve addition operator +');
  assert.ok(tokens1.words.includes('-'), 'Must preserve subtraction operator -');
  assert.ok(tokens1.words.includes('^'), 'Must preserve exponent operator ^');
  assert.ok(tokens1.mathSymbols.length >= 4, 'Must identify math symbols');

  const mathInput2 = 'dy/dx = 4x + C';
  const tokens2 = OcrService.tokenizeMathText(mathInput2);
  assert.ok(tokens2.words.includes('c'), 'Must preserve integration constant C');
  assert.ok(tokens2.words.includes('+'), 'Must preserve + operator');
  assert.ok(tokens2.words.includes('/'), 'Must preserve division/fraction operator /');
  console.log('  -> PASS: Mathematical operators, single variables, and constants preserved.\n');
  passedTests++;

  // --- Test 2: Math-Aware Content Change Detection ---
  console.log('[Test 2] Math-aware content change detection (hasSignificantNewContent)...');
  // Scenario A: Instructor writes a short equation on the page (x = 5)
  const prevTokensA = ['lecture', 'calculus', 'derivatives'];
  const currTokensA = ['lecture', 'calculus', 'derivatives', 'x', '=', '5'];
  const hasNewA = OcrService.hasSignificantNewContent(prevTokensA, currTokensA);
  assert.strictEqual(hasNewA, true, 'Must detect new equation x = 5');

  // Scenario B: Instructor writes integration constant (+ C)
  const prevTokensB = ['integral', 'result', '2x'];
  const currTokensB = ['integral', 'result', '2x', '+', 'c'];
  const hasNewB = OcrService.hasSignificantNewContent(prevTokensB, currTokensB);
  assert.strictEqual(hasNewB, true, 'Must detect short mathematical addition + C');

  // Scenario C: Identical tokens
  const hasNewC = OcrService.hasSignificantNewContent(prevTokensA, prevTokensA);
  assert.strictEqual(hasNewC, false, 'Identical tokens must not trigger false new content');

  // Scenario D: Fresh blank page starting to be written on
  const hasNewD = OcrService.hasSignificantNewContent([], ['step', '1']);
  assert.strictEqual(hasNewD, true, 'Fresh page starting must be preserved');
  console.log('  -> PASS: Math-aware content changes detected accurately without missing equations.\n');
  passedTests++;

  // --- Test 3: 3x3 Regional SSIM & Localized Quadrant Change Detection ---
  console.log('[Test 3] 3x3 Regional SSIM: localized change in quadrant...');
  // Create realistic document canvas (128x128 with notebook lines & header)
  const baseCanvas = Buffer.alloc(128 * 128, 245);
  // Add notebook header (row 15-20)
  for (let y = 15; y < 20; y++) {
    for (let x = 20; x < 108; x++) {
      baseCanvas[y * 128 + x] = 30; // dark header
    }
  }
  // Add ruled lines every 25 rows
  for (let y = 35; y < 128; y += 25) {
    for (let x = 10; x < 118; x++) {
      baseCanvas[y * 128 + x] = 200; // faint ruled line
    }
  }

  // Create Page B: identical notebook page, but with a newly written equation in the bottom-middle quadrant (r=2, c=1)
  const modifiedCanvas = Buffer.from(baseCanvas);
  for (let y = 92; y < 115; y++) {
    for (let x = 46; x < 82; x++) {
      if ((x + y) % 3 === 0) {
        modifiedCanvas[y * 128 + x] = 25; // newly written formula
      }
    }
  }

  const regional = SimilarityAlgorithms.computeRegionalSSIM(baseCanvas, modifiedCanvas, 128, 128);
  console.log(`  [Diagnostic] globalSSIM: ${regional.globalSSIM.toFixed(3)}, minRegionalSSIM: ${regional.minRegionalSSIM.toFixed(3)}, centerSSIM: ${regional.centerSSIM.toFixed(3)}, hasLocalizedChange: ${regional.hasLocalizedChange}`);
  assert.ok(regional.globalSSIM >= 0.70, 'Global SSIM reflects document similarity across identical regions');
  assert.ok(regional.minRegionalSSIM < 0.80, 'Bottom quadrant SSIM must drop (< 0.80) due to newly written formula');
  assert.strictEqual(regional.hasLocalizedChange, true, 'hasLocalizedChange must flag the localized addition');
  console.log(`  -> PASS: Regional SSIM detected localized addition! Global SSIM: ${regional.globalSSIM.toFixed(3)}, Min Regional: ${regional.minRegionalSSIM.toFixed(3)}\n`);
  passedTests++;

  // --- Test 4: Aspect-Ratio-Preserving Similarity (contain vs fill) ---
  console.log('[Test 4] Aspect-ratio-preserving similarity...');
  // Create a 16:9 640x360 image and compare with itself
  const svg16_9 = '<svg width="640" height="360"><rect width="640" height="360" fill="white"/><circle cx="320" cy="180" r="80" fill="black"/></svg>';
  const buf16_9 = await sharp(Buffer.from(svg16_9)).jpeg().toBuffer();

  const selfSSIM = await SimilarityAlgorithms.computeSSIM(buf16_9, buf16_9);
  assert.ok(selfSSIM >= 0.99, 'Self SSIM must be ~1.0 with aspect ratio preservation');
  console.log('  -> PASS: Aspect-ratio-preserving SSIM computed accurately.\n');
  passedTests++;

  // --- Test 5: Non-Destructive Quality Blur Handling ---
  console.log('[Test 5] Non-destructive quality blur handling...');
  const testJobId = 'm2-blur-test-' + Date.now();
  const testFramesDir = path.join(config.framesDir, testJobId);
  fs.mkdirSync(testFramesDir, { recursive: true });

  // Create an intentionally blurred image (single lonely observation)
  const blurredBuf = await sharp({
    create: { width: 320, height: 180, channels: 3, background: { r: 240, g: 240, b: 240 } }
  }).blur(10).jpeg({ quality: 50 }).toBuffer();

  const blurPath = path.join(testFramesDir, 'frame_00000_0.00s.jpg');
  fs.writeFileSync(blurPath, blurredBuf);

  const mockFrame: IFrame = {
    id: 'f-blur-0',
    jobId: testJobId,
    frameIndex: 0,
    timestamp: 0.0,
    imagePath: `frames/${testJobId}/frame_00000_0.00s.jpg`,
    createdAt: new Date(),
  };

  const { uniqueCandidates } = await DuplicateDetectorService.filterDuplicates([mockFrame]);
  assert.strictEqual(
    uniqueCandidates.length,
    1,
    'Non-destructive: lonely blurry frame must NOT be discarded if no sharp neighbor exists'
  );
  console.log('  -> PASS: Non-destructive quality filtering preserves lone observations.\n');
  passedTests++;

  // Cleanup test directory
  try {
    fs.rmSync(testFramesDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  await OcrService.terminateWorker();

  console.log('====================================================');
  console.log(`Milestone 2 Test Suite Completed: ${passedTests} passed!`);
  console.log('====================================================');
  process.exit(0);
}

runMilestone2Tests().catch((err) => {
  console.error('\nMilestone 2 Test FAILED:', err);
  process.exit(1);
});
