import { UniqueCandidate } from './duplicateDetector.service.js';
import { SimilarityAlgorithms, RegionalSSIMResult } from '../algorithms/similarity.js';
import { ImageAlignmentAlgorithms, ScrollAlignmentResult, MovementType } from '../algorithms/imageAlignment.js';
import { OcrService } from './ocr.service.js';

export type PageRelationship =
  | 'SAME_VIEW'          // Exact same static view (identical content)
  | 'CONTENT_CHANGE'     // Same view, but new handwritten notes or equations were added
  | 'SCROLL'             // Vertical continuous document scrolling
  | 'ZOOM'               // Camera zoom in/out of a sub-region
  | 'PAN'                // Horizontal desk movement / camera shift
  | 'ROTATION'           // Camera/notebook rotation
  | 'NEW_PAGE'           // Definite transition to a new page
  | 'NEEDS_REVIEW'       // Ambiguous or uncertain transition
  | 'UNKNOWN';

export interface RelationshipAnalysis {
  relationship: PageRelationship;
  confidence: number;
  shiftX?: number;
  shiftY?: number;
  movement?: MovementType;
  globalSSIM?: number;
  minRegionalSSIM?: number;
  hasLocalizedChange?: boolean;
  warnings: string[];
}

export class PageRelationshipService {
  /**
   * Classifies the relationship between two consecutive candidate observations.
   * Evaluates:
   * 1. Aspect & 90-degree rotation changes
   * 2. Zoom relations (sub-region crop of full page)
   * 3. Bidirectional translation & alignment (scrolling vs horizontal panning)
   * 4. 3x3 Regional SSIM for localized handwriting additions
   * 5. Math-aware OCR content difference
   */
  static async classifyRelationship(
    candidateA: UniqueCandidate,
    candidateB: UniqueCandidate
  ): Promise<RelationshipAnalysis> {
    const warnings: string[] = [];

    // 1. Check for Scale / Rotation Swap (e.g. 90-degree camera re-orientation)
    const scaleRot = await ImageAlignmentAlgorithms.detectScaleAndRotation(
      candidateA.absolutePath,
      candidateB.absolutePath
    );

    if (scaleRot.isRotated) {
      return {
        relationship: 'ROTATION',
        confidence: 0.90,
        warnings: ['Orientation swapped 90 degrees'],
      };
    }

    // 2. Check for Zoom / Sub-Region Relation
    const zoom = await SimilarityAlgorithms.checkZoomRelation(
      candidateA.absolutePath,
      candidateB.absolutePath
    );

    if (zoom.isZoom && zoom.confidence >= 0.78) {
      return {
        relationship: 'ZOOM',
        confidence: zoom.confidence,
        warnings: [`Zoom detected: wider frame is ${zoom.widerFrame}`],
      };
    }

    // 3. Compute 3x3 Regional SSIM (< 0.1ms)
    const regional: RegionalSSIMResult = SimilarityAlgorithms.computeRegionalSSIM(
      candidateA.thumbnail,
      candidateB.thumbnail
    );

    const ssim = regional.globalSSIM;
    const hasLocalizedChange = regional.hasLocalizedChange;

    // 4. Evaluate Bidirectional Motion & Alignment
    const align: ScrollAlignmentResult = await ImageAlignmentAlgorithms.detectAlignment(
      candidateA.absolutePath,
      candidateB.absolutePath
    );

    if (align.isAligned && align.alignmentConfidence >= 0.75) {
      if (align.movement === 'VERTICAL' && Math.abs(align.shiftY) >= 16) {
        // Continuous vertical document scrolling
        if (align.ambiguityRatio >= 1.15 && align.structuralSimilarity >= 0.80) {
          return {
            relationship: 'SCROLL',
            confidence: align.alignmentConfidence,
            shiftX: align.shiftX,
            shiftY: align.shiftY,
            movement: align.movement,
            globalSSIM: ssim,
            minRegionalSSIM: regional.minRegionalSSIM,
            warnings: align.warnings,
          };
        }
      } else if (align.movement === 'HORIZONTAL' && Math.abs(align.shiftX) >= 16) {
        // Horizontal desk / camera movement
        return {
          relationship: 'PAN',
          confidence: align.alignmentConfidence,
          shiftX: align.shiftX,
          shiftY: align.shiftY,
          movement: align.movement,
          globalSSIM: ssim,
          minRegionalSSIM: regional.minRegionalSSIM,
          warnings: ['Horizontal desk repositioning detected'],
        };
      }
    }

    // 5. Visual Similarity & Handwriting Evaluation
    if (ssim >= 0.94 && !hasLocalizedChange) {
      return {
        relationship: 'SAME_VIEW',
        confidence: ssim,
        globalSSIM: ssim,
        minRegionalSSIM: regional.minRegionalSSIM,
        warnings: [],
      };
    }

    if (hasLocalizedChange || (ssim >= 0.85 && ssim < 0.94)) {
      // Check OCR content for newly added handwriting/equations
      const wordsA = candidateA.ocrWords || [];
      let wordsB = candidateB.ocrWords;

      if (!wordsB) {
        const ocrB = await OcrService.recognizeText(candidateB.absolutePath);
        wordsB = ocrB.words;
        candidateB.ocrWords = wordsB;
      }

      // Retention check: in continuous note-taking on the SAME page, previous notes are retained.
      // If previous notes are mostly absent (retention < 40%), this is a NEW PAGE even if ruling lines are similar!
      const setB = new Set(wordsB.map((w) => w.toLowerCase()));
      const commonWords = wordsA.filter((w) => setB.has(w.toLowerCase()));
      const retentionRatio = wordsA.length > 0 ? commonWords.length / wordsA.length : 1.0;

      if (wordsA.length >= 3 && retentionRatio < 0.40) {
        return {
          relationship: 'NEW_PAGE',
          confidence: 0.90,
          globalSSIM: ssim,
          minRegionalSSIM: regional.minRegionalSSIM,
          warnings: ['Previous page content replaced; new page detected'],
        };
      }

      const hasNewContent = OcrService.hasSignificantNewContent(wordsA, wordsB);
      if (hasNewContent || hasLocalizedChange) {
        return {
          relationship: 'CONTENT_CHANGE',
          confidence: 0.92,
          globalSSIM: ssim,
          minRegionalSSIM: regional.minRegionalSSIM,
          hasLocalizedChange,
          warnings: ['Handwritten notes or equations added to page'],
        };
      }

      if (ssim >= 0.90) {
        return {
          relationship: 'SAME_VIEW',
          confidence: ssim,
          globalSSIM: ssim,
          minRegionalSSIM: regional.minRegionalSSIM,
          warnings: [],
        };
      }
    }

    // 6. Transition to completely new page
    if (ssim < 0.70) {
      return {
        relationship: 'NEW_PAGE',
        confidence: 0.90,
        globalSSIM: ssim,
        minRegionalSSIM: regional.minRegionalSSIM,
        warnings: [],
      };
    }

    // 7. Ambiguous intermediate transition
    return {
      relationship: 'NEEDS_REVIEW',
      confidence: 0.65,
      globalSSIM: ssim,
      minRegionalSSIM: regional.minRegionalSSIM,
      warnings: ['Ambiguous page transition; flag for review'],
    };
  }
}

