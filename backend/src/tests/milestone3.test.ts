/**
 * Milestone 3 Test Suite:
 * - Bidirectional Vertical Alignment (Downward & Upward Scrolling)
 * - Horizontal Panning / Camera Shift Detection
 * - Match Ambiguity Checking (Lowe's Ratio on Structured vs Blank Backgrounds)
 * - Bidirectional Verified Stitching with Safe Canvas Limits
 * - Scale & Rotation Estimation
 */

import assert from 'assert';
import sharp from 'sharp';
import { ImageAlignmentAlgorithms } from '../algorithms/imageAlignment.js';

async function runMilestone3Tests() {
  console.log('====================================================');
  console.log('Running Milestone 3 Verification Tests');
  console.log('====================================================\n');

  let passedTests = 0;

  // Helper to generate a test document image with distinctive text lines
  const createDocumentImage = async (offsetY = 0, offsetX = 0): Promise<Buffer> => {
    let textLines = '';
    for (let i = 0; i < 15; i++) {
      const yPos = 40 + i * 45 - offsetY;
      const xPos = 50 + offsetX;
      if (yPos > -20 && yPos < 680) {
        textLines += `<text x="${xPos}" y="${yPos}" font-size="22" font-family="sans-serif" fill="#222">Lecture Notes Section ${i + 1}: f(x) = ${i}x^2 + ${i * 3}</text>`;
      }
    }

    const svg = `
      <svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
        <rect width="640" height="360" fill="#fdfdfd"/>
        <line x1="40" y1="0" x2="40" y2="360" stroke="#f0a0a0" stroke-width="2"/>
        ${textLines}
      </svg>
    `;

    return await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
  };

  // --- Test 1: Downward Scrolling Alignment (shiftY > 0) ---
  console.log('[Test 1] Downward scrolling alignment (shiftY > 0)...');
  const frameA = await createDocumentImage(0);
  const frameB = await createDocumentImage(60); // scrolled down 60px

  const downResult = await ImageAlignmentAlgorithms.detectAlignment(frameA, frameB);
  console.log(`  [Diagnostic] shiftY: ${downResult.shiftY}, shiftX: ${downResult.shiftX}, isAligned: ${downResult.isAligned}, movement: ${downResult.movement}, ambiguityRatio: ${downResult.ambiguityRatio}`);

  assert.strictEqual(downResult.isAligned, true, 'Must detect valid downward scroll alignment');
  assert.ok(downResult.shiftY > 30 && downResult.shiftY < 90, `ShiftY (${downResult.shiftY}) should match expected ~60px`);
  assert.strictEqual(downResult.movement, 'VERTICAL', 'Movement must be VERTICAL');
  assert.ok(downResult.structuralSimilarity >= 0.80, 'Structural similarity must be high');
  assert.ok(downResult.ambiguityRatio >= 1.15, 'Ambiguity ratio must distinguish unique match');
  console.log('  -> PASS: Downward scrolling detected accurately with high structural confidence.\n');
  passedTests++;

  // --- Test 2: Upward Scrolling Alignment (shiftY < 0) ---
  console.log('[Test 2] Upward scrolling alignment (shiftY < 0)...');
  const upResult = await ImageAlignmentAlgorithms.detectAlignment(frameB, frameA); // reverse order
  console.log(`  [Diagnostic] shiftY: ${upResult.shiftY}, shiftX: ${upResult.shiftX}, isAligned: ${upResult.isAligned}, movement: ${upResult.movement}`);

  assert.strictEqual(upResult.isAligned, true, 'Must detect valid upward scroll alignment');
  assert.ok(upResult.shiftY < -30 && upResult.shiftY > -90, `ShiftY (${upResult.shiftY}) should be negative (~-60px)`);
  assert.strictEqual(upResult.movement, 'VERTICAL', 'Movement must be VERTICAL');
  console.log('  -> PASS: Upward scrolling detected accurately (negative shiftY).\n');
  passedTests++;

  // --- Test 3: Horizontal Camera Movement / Desk Shift Detection ---
  console.log('[Test 3] Horizontal panning / desk camera shift...');
  const frameC = await createDocumentImage(0, 30); // shifted horizontally 30px
  const horizResult = await ImageAlignmentAlgorithms.detectAlignment(frameA, frameC);
  console.log(`  [Diagnostic] shiftY: ${horizResult.shiftY}, shiftX: ${horizResult.shiftX}, movement: ${horizResult.movement}`);

  assert.ok(Math.abs(horizResult.shiftX) > 10, 'Horizontal shiftX must be detected');
  assert.ok(['HORIZONTAL', 'DIAGONAL'].includes(horizResult.movement), 'Movement must be HORIZONTAL or DIAGONAL');
  console.log('  -> PASS: Horizontal displacement recognized, preventing false vertical scroll classification.\n');
  passedTests++;

  // --- Test 4: Ambiguity Detection on Blank / Low-Texture Paper ---
  console.log('[Test 4] Ambiguity checking on featureless background...');
  const blankBufA = await sharp({
    create: { width: 320, height: 180, channels: 3, background: { r: 250, g: 250, b: 250 } }
  }).jpeg().toBuffer();
  const blankBufB = await sharp({
    create: { width: 320, height: 180, channels: 3, background: { r: 250, g: 250, b: 250 } }
  }).jpeg().toBuffer();

  const blankResult = await ImageAlignmentAlgorithms.detectAlignment(blankBufA, blankBufB);
  console.log(`  [Diagnostic] blank ambiguityRatio: ${blankResult.ambiguityRatio}, warnings: ${blankResult.warnings.join(', ')}`);
  assert.ok(blankResult.warnings.length > 0 || blankResult.ambiguityRatio < 1.15, 'Ambiguity check must flag featureless paper');
  console.log('  -> PASS: Low-texture paper flagged to prevent false-positive seam joins.\n');
  passedTests++;

  // --- Test 5: Bidirectional Stitching & Canvas Limit Safety ---
  console.log('[Test 5] Bidirectional stitching with safe canvas limits...');
  // Downward stitch (shiftY = 60)
  const stitchedDown = await ImageAlignmentAlgorithms.stitchVerticalPair(frameA, frameB, 60);
  const metaDown = await sharp(stitchedDown).metadata();
  assert.strictEqual(metaDown.height, 360 + 60, 'Downward stitched height must equal baseHeight + shiftY (420px)');

  // Upward stitch (shiftY = -60)
  const stitchedUp = await ImageAlignmentAlgorithms.stitchVerticalPair(frameA, frameB, -60);
  const metaUp = await sharp(stitchedUp).metadata();
  assert.strictEqual(metaUp.height, 360 + 60, 'Upward stitched height must equal baseHeight + |shiftY| (420px)');

  // Runaway canvas guard test
  await assert.rejects(
    async () => {
      await ImageAlignmentAlgorithms.stitchVerticalPair(frameA, frameB, 6500);
    },
    /exceeds safe limit/,
    'Must prevent unprintable runaway canvas sizes (>6000px)'
  );
  console.log('  -> PASS: Bidirectional stitching verified; runaway canvas guard enforced.\n');
  passedTests++;

  // --- Test 6: Scale & Rotation Estimation ---
  console.log('[Test 6] Scale & Rotation estimation...');
  const rotatedFrame = await sharp(frameA).rotate(90).jpeg().toBuffer();
  const rotResult = await ImageAlignmentAlgorithms.detectScaleAndRotation(frameA, rotatedFrame);
  assert.strictEqual(rotResult.isRotated, true, 'Must detect 90-degree aspect/dimension swap');
  assert.strictEqual(rotResult.rotationAngle, 90, 'Must report 90 degree rotation');
  console.log('  -> PASS: Scale and rotation detection verified.\n');
  passedTests++;

  console.log('====================================================');
  console.log(`Milestone 3 Test Suite Completed: ${passedTests} passed!`);
  console.log('====================================================');
  process.exit(0);
}

runMilestone3Tests().catch((err) => {
  console.error('\nMilestone 3 Test FAILED:', err);
  process.exit(1);
});

