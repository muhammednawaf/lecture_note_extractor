/**
 * Milestone 6 Test Suite:
 * - API Contract: reconstructionStatus ('VERIFIED', 'NEEDS_REVIEW', 'FAILED')
 * - Warning & review metadata persistence
 * - PageRepository status updates & manual verification toggle
 * - Safe review & curation contract validation
 */

import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { PageRepository, IPage } from '../models/Page.model.js';
import { JobRepository } from '../models/Job.model.js';
import { PageDetectorService } from '../services/pageDetector.service.js';
import { FrameRepository } from '../models/Frame.model.js';
import sharp from 'sharp';
import { config } from '../core/config.js';

async function runMilestone6Tests() {
  console.log('====================================================');
  console.log('Running Milestone 6 Verification Tests');
  console.log('====================================================\n');

  let passedTests = 0;
  const testJobId = 'm6-test-' + Date.now();
  PageRepository.clearMemoryStore();
  FrameRepository.clearMemoryStore();

  // ----------------------------------------------------
  // Test 1: Page creation with complete review metadata
  // ----------------------------------------------------
  console.log('Test 1: PageRepository persists reconstructionStatus and warnings...');
  const page1 = await PageRepository.create({
    jobId: testJobId,
    pageNumber: 1,
    imagePath: `pages/${testJobId}/page_0001.jpg`,
    startTimestamp: 0.0,
    endTimestamp: 15.0,
    qualityScore: 0.92,
    confidence: 0.95,
    isEdited: false,
    sourceFrameIds: ['f-1', 'f-2'],
    reconstructionStatus: 'VERIFIED',
    warnings: ['Stitched from continuous scrolling sequence'],
    pageIdentityId: 'identity-ch1',
  });

  assert.strictEqual(page1.reconstructionStatus, 'VERIFIED');
  assert.strictEqual(page1.warnings.length, 1);
  assert.strictEqual(page1.sourceFrameIds.length, 2);
  assert.strictEqual(page1.pageIdentityId, 'identity-ch1');
  console.log('  ✓ Page 1 created with VERIFIED status and multi-frame provenance');
  passedTests++;

  // ----------------------------------------------------
  // Test 2: Page created with NEEDS_REVIEW status
  // ----------------------------------------------------
  console.log('\nTest 2: PageRepository supports NEEDS_REVIEW and review warnings...');
  const page2 = await PageRepository.create({
    jobId: testJobId,
    pageNumber: 2,
    imagePath: `pages/${testJobId}/page_0002.jpg`,
    startTimestamp: 16.0,
    endTimestamp: 30.0,
    qualityScore: 0.65,
    confidence: 0.70,
    isEdited: false,
    sourceFrameIds: ['f-3'],
    reconstructionStatus: 'NEEDS_REVIEW',
    warnings: [
      'Zoom geometric alignment uncertain; preserved as distinct page for review',
      'Low confidence detection; verify page content',
    ],
    pageIdentityId: 'identity-ch2',
  });

  assert.strictEqual(page2.reconstructionStatus, 'NEEDS_REVIEW');
  assert.strictEqual(page2.warnings.length, 2);
  console.log('  ✓ Page 2 created with NEEDS_REVIEW status and 2 explicit review warnings');
  passedTests++;

  // ----------------------------------------------------
  // Test 3: Manual user verification toggle (Review workflow)
  // ----------------------------------------------------
  console.log('\nTest 3: User verification toggle updates reconstructionStatus to VERIFIED...');
  const updatedPage2 = await PageRepository.update(page2.id, {
    reconstructionStatus: 'VERIFIED',
    isEdited: true,
  });

  assert.ok(updatedPage2 !== null);
  assert.strictEqual(updatedPage2?.reconstructionStatus, 'VERIFIED');
  assert.strictEqual(updatedPage2?.isEdited, true);

  // Verify fetch returns the updated status
  const fetched = await PageRepository.findById(page2.id);
  assert.strictEqual(fetched?.reconstructionStatus, 'VERIFIED');
  assert.strictEqual(fetched?.isEdited, true);
  console.log('  ✓ Page successfully verified by user and persisted as isEdited: true');
  passedTests++;

  // ----------------------------------------------------
  // Test 4: Reprocessing preservation of verified/edited pages
  // ----------------------------------------------------
  console.log('\nTest 4: Idempotent reprocessing preserves user-verified pages...');
  const editedList = await PageRepository.getEditedPages(testJobId);
  assert.strictEqual(editedList.length, 1, 'Only updated page should be marked edited');
  assert.strictEqual(editedList[0].id, page2.id);

  // Reprocessing deletion preserves edited
  const deleted = await PageRepository.deleteByJobId(testJobId, { preserveEdited: true });
  assert.strictEqual(deleted, 1, 'Unedited page 1 should be deleted, page 2 preserved');

  const remaining = await PageRepository.findByJobId(testJobId);
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].id, page2.id);
  console.log('  ✓ Verified page protected across reprocessing cycle');
  passedTests++;

  // ----------------------------------------------------
  // Test 5: Reordering preserves extended metadata
  // ----------------------------------------------------
  console.log('\nTest 5: Reordering maintains sourceFrameIds, warnings, and pageIdentityId...');
  const page3 = await PageRepository.create({
    jobId: testJobId,
    pageNumber: 2,
    imagePath: `pages/${testJobId}/page_0003.jpg`,
    startTimestamp: 35.0,
    endTimestamp: 40.0,
    qualityScore: 0.95,
    confidence: 1.0,
    isEdited: false,
    sourceFrameIds: ['f-4', 'f-5', 'f-6'],
    reconstructionStatus: 'VERIFIED',
    warnings: ['Stitched from continuous scrolling sequence'],
    pageIdentityId: 'identity-ch3',
  });

  const reordered = await PageRepository.reorder(testJobId, [page3.id, page2.id]);
  assert.strictEqual(reordered[0].id, page3.id);
  assert.strictEqual(reordered[0].pageNumber, 1);
  assert.strictEqual(reordered[0].sourceFrameIds.length, 3);
  assert.strictEqual(reordered[0].warnings.length, 1);

  assert.strictEqual(reordered[1].id, page2.id);
  assert.strictEqual(reordered[1].pageNumber, 2);
  console.log('  ✓ Reordering completed cleanly with all provenance and review metadata intact');
  passedTests++;

  console.log('\n====================================================');
  console.log(`Milestone 6 Results: ${passedTests}/5 tests PASSED`);
  console.log('====================================================\n');
}

runMilestone6Tests().catch((err) => {
  console.error('Milestone 6 Test Failed:', err);
  process.exit(1);
});
