import { UniqueCandidate } from './duplicateDetector.service.js';
import { PageRelationshipService, PageRelationship } from './pageRelationship.service.js';
import { PageIdentityTracker } from './pageIdentity.service.js';

export type SegmentType = 'STATIC_PAGE' | 'SCROLLING_PAGE' | 'ZOOM_DETAIL' | 'NEEDS_REVIEW';

export interface PageSegment {
  type: SegmentType;
  candidates: UniqueCandidate[];
  shifts: number[]; // vertical shifts between consecutive frames in the segment
  startTimestamp: number;
  endTimestamp: number;
  confidence: number;
  pageIdentityId?: string;
  relationship: PageRelationship;
  warnings: string[];
}

export class ScrollDetectorService {
  /**
   * Analyzes transitions between unique candidate frames using multi-factor relationship classification.
   * Tracks logical page identity across the video and groups frames into:
   * - STATIC_PAGE: stationary page or handwriting additions on the same page
   * - SCROLLING_PAGE: verified continuous vertical scrolling
   * - ZOOM_DETAIL: camera zoom into equations/sections
   * - NEEDS_REVIEW: ambiguous or uncertain transitions flagged for review
   */
  static async identifyScrollSequences(
    candidates: UniqueCandidate[]
  ): Promise<PageSegment[]> {
    if (candidates.length === 0) return [];

    const tracker = new PageIdentityTracker(15);
    const segments: PageSegment[] = [];

    // Assign identity to first candidate
    const firstIdentity = await tracker.assignIdentity(candidates[0]);

    let currentSegment: PageSegment = {
      type: 'STATIC_PAGE',
      candidates: [candidates[0]],
      shifts: [0],
      startTimestamp: candidates[0].startTimestamp,
      endTimestamp: candidates[0].endTimestamp,
      confidence: 1.0,
      pageIdentityId: firstIdentity.identityId,
      relationship: 'SAME_VIEW',
      warnings: [],
    };

    for (let i = 0; i < candidates.length - 1; i++) {
      const prev = candidates[i];
      const next = candidates[i + 1];

      // Step 1: Assign or track logical page identity
      const identityAssignment = await tracker.assignIdentity(next);

      // Step 2: Classify exact relationship between adjacent frames
      const relAnalysis = await PageRelationshipService.classifyRelationship(prev, next);

      // Case A: Continuous verified vertical scroll
      if (relAnalysis.relationship === 'SCROLL' && (relAnalysis.shiftY !== undefined)) {
        currentSegment.type = 'SCROLLING_PAGE';
        currentSegment.candidates.push(next);
        currentSegment.shifts.push(relAnalysis.shiftY);
        currentSegment.endTimestamp = next.endTimestamp;
        currentSegment.confidence = Math.min(currentSegment.confidence, relAnalysis.confidence);
        currentSegment.relationship = 'SCROLL';
        if (relAnalysis.warnings.length > 0) {
          currentSegment.warnings.push(...relAnalysis.warnings);
        }
      }
      // Case B: Same view, handwriting addition, or horizontal desk repositioning on same page
      else if (
        ['SAME_VIEW', 'CONTENT_CHANGE', 'PAN'].includes(relAnalysis.relationship) &&
        !identityAssignment.isReturnToPreviousPage
      ) {
        currentSegment.candidates.push(next);
        currentSegment.shifts.push(relAnalysis.shiftY || 0);
        currentSegment.endTimestamp = next.endTimestamp;
        currentSegment.relationship = relAnalysis.relationship;
        if (relAnalysis.warnings.length > 0) {
          currentSegment.warnings.push(...relAnalysis.warnings);
        }
      }
      // Case C: Camera Zoom into an equation or detail
      else if (relAnalysis.relationship === 'ZOOM') {
        segments.push(currentSegment);

        currentSegment = {
          type: 'ZOOM_DETAIL',
          candidates: [next],
          shifts: [0],
          startTimestamp: next.startTimestamp,
          endTimestamp: next.endTimestamp,
          confidence: relAnalysis.confidence,
          pageIdentityId: identityAssignment.identityId,
          relationship: 'ZOOM',
          warnings: relAnalysis.warnings,
        };
      }
      // Case D: Return to an earlier page or clear new page transition
      else {
        segments.push(currentSegment);

        const isUncertain = relAnalysis.relationship === 'NEEDS_REVIEW';
        currentSegment = {
          type: isUncertain ? 'NEEDS_REVIEW' : 'STATIC_PAGE',
          candidates: [next],
          shifts: [0],
          startTimestamp: next.startTimestamp,
          endTimestamp: next.endTimestamp,
          confidence: relAnalysis.confidence,
          pageIdentityId: identityAssignment.identityId,
          relationship: relAnalysis.relationship,
          warnings: relAnalysis.warnings,
        };
      }
    }

    segments.push(currentSegment);
    return segments;
  }
}
