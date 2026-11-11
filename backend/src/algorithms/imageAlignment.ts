import sharp from 'sharp';
import { SimilarityAlgorithms } from './similarity.js';

export type MovementType = 'VERTICAL' | 'HORIZONTAL' | 'DIAGONAL' | 'NONE' | 'UNKNOWN';

export interface ScrollAlignmentResult {
  isAligned: boolean;
  isScrolling: boolean; // backward-compat alias
  shiftX: number;       // horizontal shift (pixels, positive = right, negative = left)
  shiftY: number;       // vertical shift (pixels, positive = scrolled down, negative = scrolled up)
  overlapWidth: number;
  overlapHeight: number;
  pixelDifference: number;
  structuralSimilarity: number;
  ambiguityRatio: number;
  overlapConfidence: number; // backward-compat alias
  alignmentConfidence: number;
  movement: MovementType;
  warnings: string[];
}

export interface ScaleRotationResult {
  isRotated: boolean;
  rotationAngle: 0 | 90 | 180 | 270;
  scaleRatio: number; // widthB / widthA
  isAspectChanged: boolean;
}

export class ImageAlignmentAlgorithms {
  /**
   * Evaluates bidirectional (up/down/horizontal) displacement between two frames.
   * Features:
   * - Searches both positive (downward) and negative (upward) vertical shifts.
   * - Detects horizontal displacement (panning / desk camera movement).
   * - Evaluates match ambiguity (second-best error vs best error) to distinguish real content from blank paper.
   * - Computes overlap structural similarity (SSIM) before approving alignment.
   */
  static async detectAlignment(
    imageSourceA: string | Buffer,
    imageSourceB: string | Buffer
  ): Promise<ScrollAlignmentResult> {
    const sampleWidth = 320;
    const [metaA, metaB] = await Promise.all([
      sharp(imageSourceA).metadata(),
      sharp(imageSourceB).metadata(),
    ]);

    const origWidth = metaA.width || 1280;
    const origHeight = metaA.height || 720;

    const sampleHeight = Math.max(100, Math.round((sampleWidth / origWidth) * origHeight));
    const scaleX = origWidth / sampleWidth;
    const scaleY = origHeight / sampleHeight;

    // Aspect-ratio-preserving downsampled grayscale maps
    const [rawA, rawB] = await Promise.all([
      sharp(imageSourceA)
        .resize(sampleWidth, sampleHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
        .grayscale()
        .raw()
        .toBuffer(),
      sharp(imageSourceB)
        .resize(sampleWidth, sampleHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
        .grayscale()
        .raw()
        .toBuffer(),
    ]);

    const W = sampleWidth;
    const H = sampleHeight;

    const minShiftSample = Math.max(3, Math.round(12 / scaleY));
    const maxShiftSample = Math.round(H * 0.75);

    let bestShiftY = 0;
    let minError = Infinity;
    let secondBestError = Infinity;
    let bestOverlapRows = 0;

    // Search 1: Downward scroll (shiftY > 0: content moved up, new bottom content in B)
    // Row y in A matches row (y - shift) in B
    for (let shift = minShiftSample; shift <= maxShiftSample; shift += 2) {
      const overlapRows = H - shift;
      if (overlapRows < Math.round(H * 0.22)) continue;

      let diffSum = 0;
      let count = 0;

      for (let yA = shift; yA < H; yA += 2) {
        const yB = yA - shift;
        const rowOffsetA = yA * W;
        const rowOffsetB = yB * W;

        for (let x = 0; x < W; x += 4) {
          diffSum += Math.abs(rawA[rowOffsetA + x] - rawB[rowOffsetB + x]);
          count++;
        }
      }

      const meanAbsDiff = diffSum / count;
      if (meanAbsDiff < minError) {
        if (Math.abs(shift - bestShiftY) > 5) {
          secondBestError = minError;
        }
        minError = meanAbsDiff;
        bestShiftY = shift;
        bestOverlapRows = overlapRows;
      } else if (meanAbsDiff < secondBestError && Math.abs(shift - bestShiftY) > 5) {
        secondBestError = meanAbsDiff;
      }
    }

    // Search 2: Upward scroll (shiftY < 0: content moved down, new top content in B)
    // Row y in A matches row (y + |shift|) in B
    for (let shift = minShiftSample; shift <= maxShiftSample; shift += 2) {
      const overlapRows = H - shift;
      if (overlapRows < Math.round(H * 0.22)) continue;

      let diffSum = 0;
      let count = 0;

      for (let yA = 0; yA < overlapRows; yA += 2) {
        const yB = yA + shift;
        const rowOffsetA = yA * W;
        const rowOffsetB = yB * W;

        for (let x = 0; x < W; x += 4) {
          diffSum += Math.abs(rawA[rowOffsetA + x] - rawB[rowOffsetB + x]);
          count++;
        }
      }

      const meanAbsDiff = diffSum / count;
      if (meanAbsDiff < minError) {
        if (Math.abs(-shift - bestShiftY) > 5) {
          secondBestError = minError;
        }
        minError = meanAbsDiff;
        bestShiftY = -shift; // negative indicates upward scroll
        bestOverlapRows = overlapRows;
      } else if (meanAbsDiff < secondBestError && Math.abs(-shift - bestShiftY) > 5) {
        secondBestError = meanAbsDiff;
      }
    }

    // Search 3: Horizontal displacement test around the best vertical shift
    let bestShiftX = 0;
    const maxShiftXSample = Math.round(30 / scaleX); // test up to ~30px horizontal jitter

    for (let dx = -maxShiftXSample; dx <= maxShiftXSample; dx += 2) {
      if (dx === 0) continue;
      let diffSum = 0;
      let count = 0;

      const yStart = bestShiftY >= 0 ? bestShiftY : 0;
      const yEnd = bestShiftY >= 0 ? H : H + bestShiftY;

      for (let yA = yStart; yA < yEnd; yA += 3) {
        const yB = bestShiftY >= 0 ? yA - bestShiftY : yA - bestShiftY;
        if (yB < 0 || yB >= H) continue;

        const rowOffsetA = yA * W;
        const rowOffsetB = yB * W;

        const xStart = dx >= 0 ? dx : 0;
        const xEnd = dx >= 0 ? W : W + dx;

        for (let xA = xStart; xA < xEnd; xA += 4) {
          const xB = xA - dx;
          diffSum += Math.abs(rawA[rowOffsetA + xA] - rawB[rowOffsetB + xB]);
          count++;
        }
      }

      if (count > 50) {
        const meanDiff = diffSum / count;
        if (meanDiff < minError - 1.5) {
          minError = meanDiff;
          bestShiftX = dx;
        }
      }
    }

    // Convert sample coordinates to original image coordinates
    const originalShiftY = Math.round(bestShiftY * scaleY);
    const originalShiftX = Math.round(bestShiftX * scaleX);
    const originalOverlapHeight = Math.max(0, origHeight - Math.abs(originalShiftY));
    const originalOverlapWidth = Math.max(0, origWidth - Math.abs(originalShiftX));

    // Ambiguity Ratio: ratio of second-best error to best error (Lowe's ratio)
    // Higher ratio means unique peak; ratio close to 1.0 means ambiguous/flat background match
    const ambiguityRatio = isFinite(secondBestError) && minError > 0
      ? Math.round((secondBestError / minError) * 100) / 100
      : 1.0;

    // Movement Classification
    let movement: MovementType = 'NONE';
    const absY = Math.abs(originalShiftY);
    const absX = Math.abs(originalShiftX);

    if (absY >= 14 && absX < 14) {
      movement = 'VERTICAL';
    } else if (absX >= 14 && absY < 14) {
      movement = 'HORIZONTAL';
    } else if (absX >= 14 && absY >= 14) {
      movement = 'DIAGONAL';
    } else {
      movement = 'NONE';
    }

    // Compute Structural Similarity on overlapping region
    let structuralSimilarity = 0.5;
    const warnings: string[] = [];

    if (bestOverlapRows >= Math.round(H * 0.2) && minError < 32.0) {
      const topA = bestShiftY >= 0 ? bestShiftY : 0;
      const topB = bestShiftY >= 0 ? 0 : -bestShiftY;
      const cropHeight = bestOverlapRows;

      const subA = Buffer.alloc(W * cropHeight);
      const subB = Buffer.alloc(W * cropHeight);

      for (let y = 0; y < cropHeight; y++) {
        rawA.copy(subA, y * W, (topA + y) * W, (topA + y + 1) * W);
        rawB.copy(subB, y * W, (topB + y) * W, (topB + y + 1) * W);
      }

      structuralSimilarity = SimilarityAlgorithms.computeRawSSIM(subA, subB);
    }

    // Ambiguity check: distinguish genuine text match from blank paper
    if (ambiguityRatio < 1.12 && minError < 6.0) {
      warnings.push('Ambiguous match: background lacks distinct texture');
    }
    if (structuralSimilarity < 0.80 && minError < 25.0) {
      warnings.push('Low structural match in overlapping seam');
    }

    // Multi-factor alignment confidence
    const isStrongMatch =
      minError < 22.0 &&
      structuralSimilarity >= 0.80 &&
      bestOverlapRows >= Math.round(H * 0.22) &&
      (ambiguityRatio >= 1.12 || minError < 12.0);

    const alignmentConfidence = isStrongMatch
      ? Math.max(
          0.0,
          Math.min(
            1.0,
            structuralSimilarity * 0.6 +
              Math.min(1.0, ambiguityRatio / 1.5) * 0.2 +
              Math.max(0, 1.0 - minError / 35.0) * 0.2
          )
        )
      : 0;

    const roundedConfidence = Math.round(alignmentConfidence * 100) / 100;

    return {
      isAligned: isStrongMatch,
      isScrolling: isStrongMatch && (movement === 'VERTICAL' || movement === 'DIAGONAL'),
      shiftX: originalShiftX,
      shiftY: originalShiftY,
      overlapWidth: originalOverlapWidth,
      overlapHeight: originalOverlapHeight,
      pixelDifference: Math.round(minError * 10) / 10,
      structuralSimilarity: Math.round(structuralSimilarity * 100) / 100,
      ambiguityRatio,
      overlapConfidence: roundedConfidence,
      alignmentConfidence: roundedConfidence,
      movement,
      warnings,
    };
  }

  /**
   * Backward-compatible wrapper for existing scroll detection.
   */
  static async detectVerticalScroll(
    imageSourceA: string | Buffer,
    imageSourceB: string | Buffer
  ): Promise<ScrollAlignmentResult> {
    return this.detectAlignment(imageSourceA, imageSourceB);
  }

  /**
   * Lightweight scale & rotation verification.
   * Checks if consecutive frames experienced camera rotation or major resolution change.
   */
  static async detectScaleAndRotation(
    imageSourceA: string | Buffer,
    imageSourceB: string | Buffer
  ): Promise<ScaleRotationResult> {
    const [metaA, metaB] = await Promise.all([
      sharp(imageSourceA).metadata(),
      sharp(imageSourceB).metadata(),
    ]);

    const wA = metaA.width || 1280;
    const hA = metaA.height || 720;
    const wB = metaB.width || 1280;
    const hB = metaB.height || 720;

    const aspectA = wA / hA;
    const aspectB = wB / hB;
    const isAspectChanged = Math.abs(aspectA - aspectB) > 0.15;

    // Check if 90 or 270 degree rotation occurred (width and height swapped)
    const isSwapped =
      Math.abs(wA - hB) < 15 && Math.abs(hA - wB) < 15;

    const scaleRatio = Math.round((wB / wA) * 100) / 100;

    return {
      isRotated: isSwapped,
      rotationAngle: isSwapped ? 90 : 0,
      scaleRatio,
      isAspectChanged,
    };
  }

  /**
   * Stitches two overlapping document frames into a single seamless image.
   * Supports both downward scrolling (shiftY > 0) and upward scrolling (shiftY < 0).
   * Enforces safety dimensions to prevent unprintable runaway canvas sizes.
   */
  static async stitchVerticalPair(
    baseImage: string | Buffer,
    nextImage: string | Buffer,
    shiftY: number
  ): Promise<Buffer> {
    const metaBase = await sharp(baseImage).metadata();
    const metaNext = await sharp(nextImage).metadata();

    const width = metaBase.width || 1280;
    const baseHeight = metaBase.height || 720;
    const nextHeight = metaNext.height || 720;

    const absShiftY = Math.abs(shiftY);

    // Safety guard: max stitched height capped at 6,000 px to prevent memory exhaustion
    if (baseHeight + absShiftY > 6000 || baseHeight >= 5500) {
      throw new Error(`Stitched page height exceeds safe limit (6000px): ${baseHeight + absShiftY}px`);
    }

    const newSliceHeight = Math.min(absShiftY, nextHeight);

    if (shiftY >= 0) {
      // Downward scroll: content moved UP, append bottom slice of nextImage
      const newSliceTop = Math.max(0, nextHeight - newSliceHeight);

      const newSliceBuffer = await sharp(nextImage)
        .extract({
          left: 0,
          top: newSliceTop,
          width,
          height: newSliceHeight,
        })
        .toBuffer();

      const combinedHeight = baseHeight + newSliceHeight;

      return await sharp({
        create: {
          width,
          height: combinedHeight,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .composite([
          { input: typeof baseImage === 'string' ? baseImage : baseImage, top: 0, left: 0 },
          { input: newSliceBuffer, top: baseHeight, left: 0 },
        ])
        .jpeg({ quality: 92 })
        .toBuffer();
    } else {
      // Upward scroll (shiftY < 0): content moved DOWN, prepend top slice of nextImage
      const newSliceBuffer = await sharp(nextImage)
        .extract({
          left: 0,
          top: 0,
          width,
          height: newSliceHeight,
        })
        .toBuffer();

      const combinedHeight = baseHeight + newSliceHeight;

      return await sharp({
        create: {
          width,
          height: combinedHeight,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .composite([
          { input: newSliceBuffer, top: 0, left: 0 },
          { input: typeof baseImage === 'string' ? baseImage : baseImage, top: newSliceHeight, left: 0 },
        ])
        .jpeg({ quality: 92 })
        .toBuffer();
    }
  }
}
