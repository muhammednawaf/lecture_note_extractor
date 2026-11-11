import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { IFrame } from '../models/Frame.model.js';
import { SimilarityAlgorithms } from '../algorithms/similarity.js';
import { QualityScoreAlgorithm } from '../algorithms/qualityScore.js';
import { OcrService } from './ocr.service.js';
import { config } from '../core/config.js';

export interface UniqueCandidate {
  frame: IFrame;
  absolutePath: string;
  thumbnail: Buffer; // Cached 128x128 grayscale buffer
  startTimestamp: number;
  endTimestamp: number;
  qualityScore: number;
  sharpness: number;
  hashHex: string;
  hashBits: number[];
  ocrWords?: string[];
}

export class DuplicateDetectorService {
  /**
   * Conservative Deduplication with OCR:
   * Prioritizes preserving complete lecture notes, handwritten derivations, and zoom details.
   * If new characters, words, or equations are written, the frame is always preserved!
   */
  static async filterDuplicates(frames: IFrame[]): Promise<{
    uniqueCandidates: UniqueCandidate[];
    duplicatesRemovedCount: number;
  }> {
    if (frames.length === 0) {
      return { uniqueCandidates: [], duplicatesRemovedCount: 0 };
    }

    const uniqueCandidates: UniqueCandidate[] = [];
    let duplicatesRemovedCount = 0;
    const targetThumbSize = 128;

    const getDiskPath = (frame: IFrame): string => {
      return path.resolve(config.storageDir, frame.imagePath);
    };

    // Sort chronologically by frameIndex
    const sorted = [...frames].sort((a, b) => a.frameIndex - b.frameIndex);

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      const currentPath = getDiskPath(current);

      if (!fs.existsSync(currentPath)) {
        continue;
      }

      const quality = await QualityScoreAlgorithm.computeQuality(currentPath);

      // Milestone 2 Non-Destructive Quality Filtering:
      // Only discard blurry frames when an existing sharper candidate already covers this temporal window (dt < 2.0s).
      // If a frame is the only observation in its window, preserve it so unique notes/equations are never lost!
      const lastAccepted = uniqueCandidates.length > 0 ? uniqueCandidates[uniqueCandidates.length - 1] : null;
      const timeSinceLast = lastAccepted ? current.timestamp - lastAccepted.endTimestamp : Infinity;

      if (quality.sharpness < 15.0 && quality.isBlurry) {
        if (lastAccepted && timeSinceLast < 2.0 && lastAccepted.sharpness >= 15.0) {
          duplicatesRemovedCount++;
          continue;
        }
      }

      // Generate aspect-ratio-preserving 128x128 thumbnail and dHash
      const [hash, currentThumb] = await Promise.all([
        SimilarityAlgorithms.computeDHash(currentPath),
        sharp(currentPath)
          .resize(targetThumbSize, targetThumbSize, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0 },
          })
          .grayscale()
          .raw()
          .toBuffer(),
      ]);

      if (uniqueCandidates.length === 0) {
        const ocr = await OcrService.recognizeText(currentPath);
        uniqueCandidates.push({
          frame: current,
          absolutePath: currentPath,
          thumbnail: currentThumb,
          startTimestamp: current.timestamp,
          endTimestamp: current.timestamp,
          qualityScore: quality.overallScore,
          sharpness: quality.sharpness,
          hashHex: hash.hashHex,
          hashBits: hash.binaryArray,
          ocrWords: ocr.words,
        });
        continue;
      }

      const lastCandidate = uniqueCandidates[uniqueCandidates.length - 1];

      // Milestone 2: 3x3 Regional SSIM and Localized Change Detection (< 0.1ms)
      const regional = SimilarityAlgorithms.computeRegionalSSIM(lastCandidate.thumbnail, currentThumb);
      const ssim = regional.globalSSIM;
      const hasLocalizedChange = regional.hasLocalizedChange;
      const timeSinceLastAccepted = current.timestamp - lastCandidate.endTimestamp;

      let isDuplicate = false;
      let detectedWords: string[] | null = null;

      // Case 1: High visual similarity (>= 0.94) AND no localized quadrant change
      if (ssim >= 0.94 && !hasLocalizedChange) {
        isDuplicate = true;
      }
      // Case 2: Moderate similarity OR Localized quadrant change (0.85 <= SSIM < 0.94 or hasLocalizedChange)
      else if (ssim >= 0.85 || hasLocalizedChange) {
        // Minor hand/pen movement within 2s without localized content change: merge as duplicate
        if (timeSinceLastAccepted < 2.0 && !hasLocalizedChange) {
          isDuplicate = true;
        } else {
          // At least 2 seconds elapsed or localized change detected: run math-aware OCR check
          const currentOcr = await OcrService.recognizeText(currentPath);
          detectedWords = currentOcr.words;
          const lastWords = lastCandidate.ocrWords || [];
          const hasNewNotes = OcrService.hasSignificantNewContent(lastWords, currentOcr.words);

          if (hasNewNotes || hasLocalizedChange) {
            // New content or localized formula addition detected -> DO NOT MERGE! Keep this frame!
            isDuplicate = false;
          } else {
            isDuplicate = true;
            if (currentOcr.words.length > lastWords.length) {
              lastCandidate.ocrWords = currentOcr.words;
            }
          }
        }
      } else {
        // Case 3: SSIM < 0.85 -> Definite visual change or new page
        isDuplicate = false;
      }

      if (isDuplicate) {
        duplicatesRemovedCount++;
        lastCandidate.endTimestamp = Math.max(lastCandidate.endTimestamp, current.timestamp);

        // Keep the sharper representative
        if (quality.sharpness > lastCandidate.sharpness) {
          lastCandidate.frame = current;
          lastCandidate.absolutePath = currentPath;
          lastCandidate.thumbnail = currentThumb;
          lastCandidate.qualityScore = quality.overallScore;
          lastCandidate.sharpness = quality.sharpness;
          lastCandidate.hashHex = hash.hashHex;
          lastCandidate.hashBits = hash.binaryArray;
          if (detectedWords && detectedWords.length > 0) {
            lastCandidate.ocrWords = detectedWords;
          }
        }
      } else {
        // Distinct new notes or zoom detail -> preserve this frame
        let words = detectedWords;
        if (!words) {
          const ocr = await OcrService.recognizeText(currentPath);
          words = ocr.words;
        }

        uniqueCandidates.push({
          frame: current,
          absolutePath: currentPath,
          thumbnail: currentThumb,
          startTimestamp: current.timestamp,
          endTimestamp: current.timestamp,
          qualityScore: quality.overallScore,
          sharpness: quality.sharpness,
          hashHex: hash.hashHex,
          hashBits: hash.binaryArray,
          ocrWords: words,
        });
      }
    }

    return {
      uniqueCandidates,
      duplicatesRemovedCount,
    };
  }
}
