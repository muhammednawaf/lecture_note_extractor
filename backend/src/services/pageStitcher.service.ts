import fs from 'fs';
import sharp from 'sharp';
import { PageSegment } from './scrollDetector.service.js';
import { ImageAlignmentAlgorithms } from '../algorithms/imageAlignment.js';
import { QualityScoreAlgorithm, QualityMetrics } from '../algorithms/qualityScore.js';
import { ZoomIntegrationService } from './zoomIntegration.service.js';

export interface ReconstructedPage {
  imageBuffer: Buffer;
  startTimestamp: number;
  endTimestamp: number;
  confidence: number;
  quality: QualityMetrics;
  isStitched: boolean;
  sourceFrameIds: string[];
  warnings: string[];
  pageIdentityId?: string;
  reconstructionStatus: 'VERIFIED' | 'NEEDS_REVIEW' | 'FAILED';
}

export class PageStitcherService {
  /**
   * Stitches and reconstructs complete document pages from page segments.
   * - Integrates verified zoom close-ups into base pages when aligned.
   * - Stitches continuous vertical scrolling sequences with safety boundary checks.
   * - Preserves uncertain zoom and scrolling segments as distinct pages flagged for review.
   */
  static async reconstructPages(segments: PageSegment[]): Promise<ReconstructedPage[]> {
    const results: ReconstructedPage[] = [];

    for (const segment of segments) {
      if (segment.type === 'ZOOM_DETAIL') {
        // Attempt geometric integration into preceding base page
        const prevPage = results.length > 0 ? results[results.length - 1] : null;
        const bestCandidate = segment.candidates.reduce(
          (best, curr) => (curr.sharpness > best.sharpness ? curr : best),
          segment.candidates[0]
        );
        const zoomBuffer = Buffer.from(fs.readFileSync(bestCandidate.absolutePath));

        let integrated = false;
        // Attempt integration if previous page exists and shares identity or was immediately preceding
        if (
          prevPage &&
          (prevPage.pageIdentityId === segment.pageIdentityId ||
            !prevPage.pageIdentityId ||
            !segment.pageIdentityId)
        ) {
          const zoomResult = await ZoomIntegrationService.integrateZoom(
            prevPage.imageBuffer,
            zoomBuffer
          );

          if (zoomResult.isIntegrated) {
            prevPage.imageBuffer = zoomResult.resultBuffer;
            prevPage.endTimestamp = Math.max(prevPage.endTimestamp, segment.endTimestamp);
            prevPage.sourceFrameIds = Array.from(
              new Set([...prevPage.sourceFrameIds, ...segment.candidates.map((c) => c.frame.id)])
            );
            if (zoomResult.warnings.length > 0) {
              prevPage.warnings = Array.from(
                new Set([...prevPage.warnings, ...zoomResult.warnings])
              );
            }
            prevPage.quality = await QualityScoreAlgorithm.computeQuality(prevPage.imageBuffer);
            integrated = true;
          }
        }

        if (!integrated) {
          // Preserve zoom as distinct page with review flag
          const quality = await QualityScoreAlgorithm.computeQuality(zoomBuffer);
          results.push({
            imageBuffer: zoomBuffer,
            startTimestamp: segment.startTimestamp,
            endTimestamp: segment.endTimestamp,
            confidence: Math.min(segment.confidence, 0.65),
            quality,
            isStitched: false,
            sourceFrameIds: segment.candidates.map((c) => c.frame.id),
            warnings:
              segment.warnings.length > 0
                ? segment.warnings
                : ['Zoom geometric alignment uncertain; preserved as distinct page for review'],
            pageIdentityId: segment.pageIdentityId,
            reconstructionStatus: 'NEEDS_REVIEW',
          });
        }
      } else if (segment.type === 'SCROLLING_PAGE' && segment.candidates.length > 1) {
        // Multi-frame vertical scrolling document to stitch
        try {
          let currentBuffer = Buffer.from(fs.readFileSync(segment.candidates[0].absolutePath));

          for (let i = 1; i < segment.candidates.length; i++) {
            const nextCandidate = segment.candidates[i];
            const rawShift = segment.shifts[i];
            const shiftY = typeof rawShift === 'number' && !isNaN(rawShift) ? rawShift : 100;

            const stitched = await ImageAlignmentAlgorithms.stitchVerticalPair(
              currentBuffer,
              nextCandidate.absolutePath,
              shiftY
            );
            currentBuffer = Buffer.from(stitched);
          }

          // Validate stitched result dimensions
          const stitchedMeta = await sharp(currentBuffer).metadata();
          const stitchedHeight = stitchedMeta.height || 0;
          if (stitchedHeight > 6000) {
            throw new Error(`Stitched height ${stitchedHeight}px exceeds 6000px safety threshold`);
          }

          const quality = await QualityScoreAlgorithm.computeQuality(currentBuffer);
          const warnings = ['Stitched from continuous scrolling sequence'];
          if (segment.warnings.length > 0) {
            warnings.push(...segment.warnings);
          }

          const status = segment.confidence >= 0.85 ? 'VERIFIED' : 'NEEDS_REVIEW';

          results.push({
            imageBuffer: currentBuffer,
            startTimestamp: segment.startTimestamp,
            endTimestamp: segment.endTimestamp,
            confidence: segment.confidence,
            quality,
            isStitched: true,
            sourceFrameIds: segment.candidates.map((c) => c.frame.id),
            warnings,
            pageIdentityId: segment.pageIdentityId,
            reconstructionStatus: status,
          });
        } catch (error: any) {
          console.warn(
            'Stitching failed for scrolling segment, falling back to original frames:',
            error?.message || error
          );
          // Preserve all original frames if stitching encounters any uncertainty
          for (const candidate of segment.candidates) {
            const buffer = Buffer.from(fs.readFileSync(candidate.absolutePath));
            const quality = await QualityScoreAlgorithm.computeQuality(buffer);
            results.push({
              imageBuffer: buffer,
              startTimestamp: candidate.startTimestamp,
              endTimestamp: candidate.endTimestamp,
              confidence: 0.6, // Flag for review
              quality,
              isStitched: false,
              sourceFrameIds: [candidate.frame.id],
              warnings: [
                'Stitching uncertain; individual frame preserved for manual review',
                ...(error?.message ? [error.message] : []),
              ],
              pageIdentityId: segment.pageIdentityId,
              reconstructionStatus: 'NEEDS_REVIEW',
            });
          }
        }
      } else {
        // STATIC_PAGE or single-frame segment or NEEDS_REVIEW
        const bestCandidate = segment.candidates.reduce(
          (best, curr) => (curr.sharpness > best.sharpness ? curr : best),
          segment.candidates[0]
        );
        const buffer = Buffer.from(fs.readFileSync(bestCandidate.absolutePath));
        const quality = await QualityScoreAlgorithm.computeQuality(buffer);

        const status =
          segment.type === 'NEEDS_REVIEW' || segment.confidence < 0.85
            ? 'NEEDS_REVIEW'
            : 'VERIFIED';

        results.push({
          imageBuffer: buffer,
          startTimestamp: segment.startTimestamp,
          endTimestamp: segment.endTimestamp,
          confidence: segment.confidence,
          quality,
          isStitched: false,
          sourceFrameIds: segment.candidates.map((c) => c.frame.id),
          warnings: segment.warnings || [],
          pageIdentityId: segment.pageIdentityId,
          reconstructionStatus: status,
        });
      }
    }

    return results;
  }
}
