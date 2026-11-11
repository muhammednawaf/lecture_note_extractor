/**
 * Test Suite: Verified Pages Only PDF Export
 * Verifies that:
 * 1. options.onlyVerified = true exports strictly VERIFIED pages, omitting NEEDS_REVIEW pages
 * 2. options.onlyVerified = false exports all pages (both verified and unverified)
 * 3. Throws a clear error if onlyVerified is true but no verified pages exist
 */

import assert from 'assert';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { PageRepository } from '../models/Page.model.js';
import { JobRepository } from '../models/Job.model.js';
import { PdfGeneratorService } from '../services/pdfGenerator.service.js';
import { config } from '../core/config.js';

async function runVerifiedExportTests() {
  console.log('====================================================');
  console.log('Running Verified Pages Only PDF Export Tests');
  console.log('====================================================\n');

  PageRepository.clearMemoryStore();

  const job = await JobRepository.create({
    videoTitle: 'Verified PDF Export Test',
    sourceType: 'UPLOAD',
  });
  const jobId = job.id;

  const jobPagesDir = path.join(config.pagesDir, jobId);
  fs.mkdirSync(jobPagesDir, { recursive: true });

  const svg = `<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="300" fill="#ffffff"/><text x="20" y="50" font-size="20" fill="#000">Test Slide</text></svg>`;
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();

  const imgPath1 = `pages/${jobId}/p1.jpg`;
  const imgPath2 = `pages/${jobId}/p2.jpg`;
  fs.writeFileSync(path.resolve(config.storageDir, imgPath1), buf);
  fs.writeFileSync(path.resolve(config.storageDir, imgPath2), buf);

  // Page 1: VERIFIED
  await PageRepository.create({
    jobId,
    pageNumber: 1,
    imagePath: imgPath1,
    startTimestamp: 0,
    endTimestamp: 5,
    qualityScore: 0.95,
    confidence: 1.0,
    isEdited: false,
    sourceFrameIds: ['f-1'],
    reconstructionStatus: 'VERIFIED',
    warnings: [],
  });

  // Page 2: NEEDS_REVIEW
  await PageRepository.create({
    jobId,
    pageNumber: 2,
    imagePath: imgPath2,
    startTimestamp: 6,
    endTimestamp: 10,
    qualityScore: 0.60,
    confidence: 0.65,
    isEdited: false,
    sourceFrameIds: ['f-2'],
    reconstructionStatus: 'NEEDS_REVIEW',
    warnings: ['Zoom geometric alignment uncertain; preserved as distinct page for review'],
  });

  // Test 1: onlyVerified = true exports strictly 1 page
  console.log('Test 1: onlyVerified: true exports strictly VERIFIED pages...');
  const resVerified = await PdfGeneratorService.generatePdf(jobId, {
    title: 'Verified Export',
    onlyVerified: true,
  });

  assert.strictEqual(resVerified.pageCount, 1, 'Only 1 verified page should be exported');
  assert.strictEqual(resVerified.verifiedOnly, true);
  const pdfBytes1 = fs.readFileSync(resVerified.filePath);
  const doc1 = await PDFDocument.load(pdfBytes1);
  assert.strictEqual(doc1.getPageCount(), 1);
  console.log('  ✓ Successfully exported strictly verified pages (1 page in PDF)');

  // Test 2: onlyVerified = false exports all 2 pages
  console.log('\nTest 2: onlyVerified: false exports all pages (both verified and unverified)...');
  const resAll = await PdfGeneratorService.generatePdf(jobId, {
    title: 'Full Export',
    onlyVerified: false,
  });

  assert.strictEqual(resAll.pageCount, 2, 'All 2 pages should be exported');
  assert.strictEqual(resAll.verifiedOnly, false);
  const pdfBytes2 = fs.readFileSync(resAll.filePath);
  const doc2 = await PDFDocument.load(pdfBytes2);
  assert.strictEqual(doc2.getPageCount(), 2);
  console.log('  ✓ Successfully exported all pages (2 pages in PDF)');

  // Test 3: Error when onlyVerified = true but 0 verified pages exist
  console.log('\nTest 3: Throws error when onlyVerified: true but 0 verified pages exist...');
  const jobEmpty = await JobRepository.create({
    videoTitle: 'Empty Verified Test',
    sourceType: 'UPLOAD',
  });
  await PageRepository.create({
    jobId: jobEmpty.id,
    pageNumber: 1,
    imagePath: imgPath1,
    startTimestamp: 0,
    endTimestamp: 5,
    qualityScore: 0.5,
    confidence: 0.5,
    isEdited: false,
    sourceFrameIds: ['f-empty'],
    reconstructionStatus: 'NEEDS_REVIEW',
    warnings: ['Low confidence'],
  });

  let errorThrown = false;
  try {
    await PdfGeneratorService.generatePdf(jobEmpty.id, { onlyVerified: true });
  } catch (err: any) {
    errorThrown = true;
    assert.ok(err.message.includes('No verified pages found'));
  }
  assert.strictEqual(errorThrown, true, 'Should throw error when 0 verified pages');
  console.log('  ✓ Threw clear descriptive error when no verified pages exist');

  // Cleanup
  fs.rmSync(jobPagesDir, { recursive: true, force: true });
  const pdfsDir = path.join(config.pdfsDir, jobId);
  if (fs.existsSync(pdfsDir)) fs.rmSync(pdfsDir, { recursive: true, force: true });

  console.log('\n====================================================');
  console.log('Verified Pages Only PDF Export: ALL TESTS PASSED!');
  console.log('====================================================\n');
}

runVerifiedExportTests().catch((err) => {
  console.error('Verified Export Test Failed:', err);
  process.exit(1);
});
