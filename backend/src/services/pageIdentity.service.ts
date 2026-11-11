import { v4 as uuidv4 } from 'uuid';
import { UniqueCandidate } from './duplicateDetector.service.js';
import { SimilarityAlgorithms, RegionalSSIMResult } from '../algorithms/similarity.js';
import { PageRelationshipService, PageRelationship } from './pageRelationship.service.js';

export interface PageIdentity {
  id: string; // unique logical page identifier
  pageNumber: number;
  firstSeenTimestamp: number;
  lastSeenTimestamp: number;
  representativeCandidate: UniqueCandidate;
  observationCount: number;
  ocrWords: string[];
}

export interface IdentityAssignmentResult {
  identityId: string;
  isReturnToPreviousPage: boolean;
  relationshipWithActive: PageRelationship;
  confidence: number;
}

export class PageIdentityTracker {
  private activeIdentities: PageIdentity[] = [];
  private currentActiveIdentity: PageIdentity | null = null;
  private readonly maxHistorySize: number;

  constructor(maxHistorySize = 15) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Resets identity history for a new job or test run.
   */
  reset(): void {
    this.activeIdentities = [];
    this.currentActiveIdentity = null;
  }

  /**
   * Assigns a logical page identity to a candidate observation.
   * Compares against the currently active identity first, then searches the sliding history
   * to detect return-to-previous-page events.
   */
  async assignIdentity(candidate: UniqueCandidate): Promise<IdentityAssignmentResult> {
    const candidateWords = candidate.ocrWords || [];

    // First candidate of the session: creates logical page 1
    if (!this.currentActiveIdentity) {
      const newIdentity: PageIdentity = {
        id: uuidv4(),
        pageNumber: 1,
        firstSeenTimestamp: candidate.startTimestamp,
        lastSeenTimestamp: candidate.endTimestamp,
        representativeCandidate: candidate,
        observationCount: 1,
        ocrWords: candidateWords,
      };

      this.currentActiveIdentity = newIdentity;
      this.activeIdentities.push(newIdentity);

      return {
        identityId: newIdentity.id,
        isReturnToPreviousPage: false,
        relationshipWithActive: 'NEW_PAGE',
        confidence: 1.0,
      };
    }

    // Step 1: Compare against currently active identity
    const activeRel = await PageRelationshipService.classifyRelationship(
      this.currentActiveIdentity.representativeCandidate,
      candidate
    );

    // If it's the same view, content change (new notes), zoom, or pan on the active page:
    if (['SAME_VIEW', 'CONTENT_CHANGE', 'ZOOM', 'PAN'].includes(activeRel.relationship)) {
      this.currentActiveIdentity.lastSeenTimestamp = Math.max(
        this.currentActiveIdentity.lastSeenTimestamp,
        candidate.endTimestamp
      );
      this.currentActiveIdentity.observationCount++;

      // Update representative candidate if current is sharper
      if (candidate.sharpness > this.currentActiveIdentity.representativeCandidate.sharpness) {
        this.currentActiveIdentity.representativeCandidate = candidate;
      }
      if (candidateWords.length > this.currentActiveIdentity.ocrWords.length) {
        this.currentActiveIdentity.ocrWords = candidateWords;
      }

      return {
        identityId: this.currentActiveIdentity.id,
        isReturnToPreviousPage: false,
        relationshipWithActive: activeRel.relationship,
        confidence: activeRel.confidence,
      };
    }

    // Step 2: Compare against sliding history of earlier pages
    // (Detect when instructor flipped back to an earlier page or slide)
    for (let i = this.activeIdentities.length - 2; i >= 0; i--) {
      const pastIdentity = this.activeIdentities[i];
      const regional: RegionalSSIMResult = SimilarityAlgorithms.computeRegionalSSIM(
        pastIdentity.representativeCandidate.thumbnail,
        candidate.thumbnail
      );

      // Check vocabulary overlap if words exist
      let vocabularyMatch = false;
      if (pastIdentity.ocrWords.length > 0 && candidateWords.length > 0) {
        const pastSet = new Set(pastIdentity.ocrWords);
        const commonCount = candidateWords.filter((w) => pastSet.has(w)).length;
        const overlapRatio = commonCount / Math.max(1, candidateWords.length);
        vocabularyMatch = overlapRatio >= 0.70;
      }

      // Strong visual match (>= 0.90) or moderate visual match with high vocabulary overlap
      if (regional.globalSSIM >= 0.90 || (regional.globalSSIM >= 0.85 && vocabularyMatch)) {
        // Re-activate this previous page!
        pastIdentity.lastSeenTimestamp = Math.max(pastIdentity.lastSeenTimestamp, candidate.endTimestamp);
        pastIdentity.observationCount++;
        this.currentActiveIdentity = pastIdentity;

        return {
          identityId: pastIdentity.id,
          isReturnToPreviousPage: true,
          relationshipWithActive: 'SAME_VIEW',
          confidence: regional.globalSSIM,
        };
      }
    }

    // Step 3: Genuinely new logical page
    const newPageNumber = this.activeIdentities.length + 1;
    const newIdentity: PageIdentity = {
      id: uuidv4(),
      pageNumber: newPageNumber,
      firstSeenTimestamp: candidate.startTimestamp,
      lastSeenTimestamp: candidate.endTimestamp,
      representativeCandidate: candidate,
      observationCount: 1,
      ocrWords: candidateWords,
    };

    this.currentActiveIdentity = newIdentity;
    this.activeIdentities.push(newIdentity);

    // Limit history size to preserve CPU and memory
    if (this.activeIdentities.length > this.maxHistorySize) {
      this.activeIdentities.shift();
    }

    return {
      identityId: newIdentity.id,
      isReturnToPreviousPage: false,
      relationshipWithActive: activeRel.relationship,
      confidence: activeRel.confidence,
    };
  }

  getIdentities(): PageIdentity[] {
    return [...this.activeIdentities];
  }
}

