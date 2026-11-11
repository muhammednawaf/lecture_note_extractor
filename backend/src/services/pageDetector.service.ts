import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { FrameRepository } from '../models/Frame.model.js';
import { PageRepository, IPage } from '../models/Page.model.js';
import { JobRepository } from '../models/Job.model.js';
import { DuplicateDetectorService } from './duplicateDetector.service.js';
import { ScrollDetectorService } from './scrollDetector.service.js';
import { PageStitcherService, ReconstructedPage } from './pageStitcher.service.js';
import { BoundaryDetectorService } from './boundaryDetector.service.js';
import { SimilarityAlgorithms } from '../algorithms/similarity.js';
import { config } from '../core/config.js';

export interface PipelineResults {
  jobId: string;
  totalFramesInput: number;
  duplicatesRemoved: number;
  scrollSequencesDetected: number;
  finalPagesExtracted: number;
  pages: IPage[];
}

export class PageDetectorService {
  /**
   * Executes conservative page detection with zero content loss:
   * 1. Uses OCR and SSIM to preserve newly written text, equations, and zoom details.
   * 2. Reconstructs scrolling sequences.
   * 3. Conservative post-pruning: only merges immediate adjacent duplicates (SSIM >= 0.92).
   * 4. Saves final pages and records to database.
   */
  static async processJob(jobId: string): Promise<PipelineResults> {
    const job = await JobRepository.findById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    await JobRepository.update(jobId, { status: 'PROCESSING' });

    // 1. Load captured frames
    const rawFrames = await FrameRepository.findByJobId(jobId, 3000);
    if (rawFrames.length === 0) {
      await JobRepository.update(jobId, { status: 'COMPLETED', totalPages: 0 });
      return {
        jobId,
        totalFramesInput: 0,
        duplicatesRemoved: 0,
        scrollSequencesDetected: 0,
        finalPagesExtracted: 0,
        pages: [],
      };
    }

    // 2. Phase 2: Duplicate Removal & OCR Content Verification
    const { uniqueCandidates, duplicatesRemovedCount } =
      await DuplicateDetectorService.filterDuplicates(rawFrames);

    // 3. Phase 3 & 4: Scrolling Detection & Stitching
    const segments = await ScrollDetectorService.identifyScrollSequences(uniqueCandidates);
    const scrollSequencesCount = segments.filter((s) => s.type === 'SCROLLING_PAGE').length;

    const reconstructed = await PageStitcherService.reconstructPages(segments);

    // 4. Conservative Post-Pruning:
    // Only merges adjacent pages that are temporally immediate (<= 15s apart) with extremely high SSIM (>= 0.95)
    // Never collapses pages across minutes or frames with handwritten additions to guarantee zero missing lecture content!
    const curatedPages: ReconstructedPage[] = [];

    for (let i = 0; i < reconstructed.length; i++) {
      const current = reconstructed[i];

      if (curatedPages.length === 0) {
        curatedPages.push(current);
        continue;
      }

      const prev = curatedPages[curatedPages.length - 1];
      const timeDiff = current.startTimestamp - prev.endTimestamp;

      // Only check immediate neighbors within 15s AND from the same logical page identity
      const sameIdentity =
        (!prev.pageIdentityId && !current.pageIdentityId) ||
        (prev.pageIdentityId && current.pageIdentityId && prev.pageIdentityId === current.pageIdentityId);

      if (timeDiff <= 15 && sameIdentity) {
        const [thumbPrev, thumbCurr] = await Promise.all([
          sharp(prev.imageBuffer)
            .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
            .grayscale()
            .raw()
            .toBuffer(),
          sharp(current.imageBuffer)
            .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
            .grayscale()
            .raw()
            .toBuffer(),
        ]);

        const regional = SimilarityAlgorithms.computeRegionalSSIM(thumbPrev, thumbCurr);

        if (regional.globalSSIM >= 0.95 && !regional.hasLocalizedChange) {
          // Genuinely identical adjacent frame on same page: merge and maintain source frame provenance
          prev.endTimestamp = Math.max(prev.endTimestamp, current.endTimestamp);
          prev.sourceFrameIds = Array.from(new Set([...prev.sourceFrameIds, ...current.sourceFrameIds]));
          if (current.warnings.length > 0) {
            prev.warnings = Array.from(new Set([...prev.warnings, ...current.warnings]));
          }
          if (current.quality.sharpness > prev.quality.sharpness) {
            prev.imageBuffer = current.imageBuffer;
            prev.quality = current.quality;
          }
          continue;
        }
      }

      curatedPages.push(current);
    }

    // Sort chronologically by original timestamp
    curatedPages.sort((a, b) => a.startTimestamp - b.startTimestamp);

    // 5. Safe, Idempotent Persistence & Preservation of User-Edited Pages
    const editedPages = await PageRepository.getEditedPages(jobId);
    const hasEditedPages = editedPages.length > 0;

    // Delete existing unedited pages from repository to prevent ghost record duplication
    await PageRepository.deleteByJobId(jobId, { preserveEdited: true });

    // Clean up disk images that are not protected as user-edited pages
    const jobPagesDir = path.join(config.pagesDir, jobId);
    const protectedFiles = new Set(editedPages.map((p) => path.basename(p.imagePath)));

    if (!fs.existsSync(jobPagesDir)) {
      fs.mkdirSync(jobPagesDir, { recursive: true });
    } else {
      const existing = fs.readdirSync(jobPagesDir).filter((f) => f.endsWith('.jpg'));
      for (const f of existing) {
        if (!protectedFiles.has(f)) {
          try {
            fs.unlinkSync(path.join(jobPagesDir, f));
          } catch {
            // ignore
          }
        }
      }
    }

    // 6. Boundary verification and final page persistence
    const createdPages: IPage[] = [];

    // If user previously edited pages, append them or merge
    let startingPageNumber = 1;

    for (let i = 0; i < curatedPages.length; i++) {
      const pageNumber = startingPageNumber++;
      const item = curatedPages[i];

      const { processedBuffer, boundingBox } = await BoundaryDetectorService.detectAndCrop(
        item.imageBuffer
      );

      const filename = `page_${String(pageNumber).padStart(4, '0')}.jpg`;
      const fileDiskPath = path.join(jobPagesDir, filename);

      fs.writeFileSync(fileDiskPath, processedBuffer);

      const relativeImagePath = `pages/${jobId}/${filename}`;
      const finalConfidence = Math.min(item.confidence, boundingBox.confidence);

      const warnings = [...(item.warnings || [])];
      if (finalConfidence < 0.85) {
        warnings.push('Low confidence detection; verify page content');
      }
      if (boundingBox.wasCropped) {
        warnings.push('Letterbox cropped');
      }

      const page = await PageRepository.create({
        jobId,
        pageNumber,
        imagePath: relativeImagePath,
        startTimestamp: item.startTimestamp,
        endTimestamp: item.endTimestamp,
        qualityScore: item.quality.overallScore,
        confidence: finalConfidence,
        isEdited: false,
        sourceFrameIds: item.sourceFrameIds || [],
        reconstructionStatus:
          item.reconstructionStatus === 'NEEDS_REVIEW' || finalConfidence < 0.85
            ? 'NEEDS_REVIEW'
            : 'VERIFIED',
        warnings,
        pageIdentityId: item.pageIdentityId,
      });

      createdPages.push(page);
    }

    // If there were protected user-edited pages, include them in final collection
    if (hasEditedPages) {
      createdPages.push(...editedPages);
      createdPages.sort((a, b) => a.pageNumber - b.pageNumber);
    }

    // Update Job metadata
    await JobRepository.update(jobId, {
      totalPages: createdPages.length,
      status: 'COMPLETED',
    });

    console.log(
      `[PageDetector] Processed job ${jobId}: ${rawFrames.length} frames -> ${createdPages.length} pages preserved.`
    );

    return {
      jobId,
      totalFramesInput: rawFrames.length,
      duplicatesRemoved: duplicatesRemovedCount,
      scrollSequencesDetected: scrollSequencesCount,
      finalPagesExtracted: createdPages.length,
      pages: createdPages,
    };
  }
}
