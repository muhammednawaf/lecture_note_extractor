import fs from 'fs';
import sharp from 'sharp';
import { SimilarityAlgorithms } from '../algorithms/similarity.js';

export interface MatchedRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ZoomIntegrationResult {
  isIntegrated: boolean;
  resultBuffer: Buffer;
  confidence: number;
  matchedRegion?: MatchedRegion;
  warnings: string[];
}

export class ZoomIntegrationService {
  /**
   * Geometrically verifies and integrates a zoomed close-up detail into a wider base page.
   * Conservative rule: Only composites detail when alignment is verified (SSIM >= 0.82).
   * Otherwise preserves the zoom frame as a separate page for review.
   */
  static async integrateZoom(
    baseImage: string | Buffer,
    zoomImage: string | Buffer
  ): Promise<ZoomIntegrationResult> {
    const baseBuffer = typeof baseImage === 'string' ? fs.readFileSync(baseImage) : baseImage;
    const zoomBuffer = typeof zoomImage === 'string' ? fs.readFileSync(zoomImage) : zoomImage;

    const [metaBase, metaZoom] = await Promise.all([
      sharp(baseBuffer).metadata(),
      sharp(zoomBuffer).metadata(),
    ]);

    const wBase = metaBase.width || 1280;
    const hBase = metaBase.height || 720;

    // 128x128 aspect-preserved thumbnail of the zoomed image
    const targetThumbSize = 128;
    const zoomThumb = await sharp(zoomBuffer)
      .resize(targetThumbSize, targetThumbSize, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
      .grayscale()
      .raw()
      .toBuffer();

    // Helper to safely clamp extraction regions inside image dimensions
    const clampBox = (left: number, top: number, width: number, height: number): MatchedRegion => {
      const l = Math.max(0, Math.min(wBase - 20, Math.round(left)));
      const t = Math.max(0, Math.min(hBase - 20, Math.round(top)));
      const w = Math.max(20, Math.min(wBase - l, Math.round(width)));
      const h = Math.max(20, Math.min(hBase - t, Math.round(height)));
      return { left: l, top: t, width: w, height: h };
    };

    // Candidate zoom regions covering typical lecture zooms and quadrants
    const candidateRegions: MatchedRegion[] = [
      clampBox(wBase * 0.15, hBase * 0.15, wBase * 0.70, hBase * 0.70), // Center zoom
      clampBox(wBase * 0.15, hBase * 0.05, wBase * 0.70, hBase * 0.65), // Upper center zoom
      clampBox(wBase * 0.15, hBase * 0.30, wBase * 0.70, hBase * 0.65), // Lower center zoom
      clampBox(wBase * 0.05, hBase * 0.05, wBase * 0.60, hBase * 0.60), // Top-left quadrant
      clampBox(wBase * 0.35, hBase * 0.05, wBase * 0.60, hBase * 0.60), // Top-right quadrant
      clampBox(wBase * 0.05, hBase * 0.35, wBase * 0.60, hBase * 0.60), // Bottom-left quadrant
      clampBox(wBase * 0.35, hBase * 0.35, wBase * 0.60, hBase * 0.60), // Bottom-right quadrant
      clampBox(wBase * 0.20, hBase * 0.20, wBase * 0.60, hBase * 0.60), // Tight center (60%)
      clampBox(wBase * 0.10, hBase * 0.10, wBase * 0.80, hBase * 0.80), // Wide center (80%)
    ];

    let bestRegion: MatchedRegion | null = null;
    let bestSSIM = 0;

    for (const region of candidateRegions) {
      try {
        const cropThumb = await sharp(baseBuffer)
          .extract(region)
          .resize(targetThumbSize, targetThumbSize, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
          .grayscale()
          .raw()
          .toBuffer();

        const ssim = SimilarityAlgorithms.computeRawSSIM(cropThumb, zoomThumb);
        if (ssim > bestSSIM) {
          bestSSIM = ssim;
          bestRegion = region;
        }
      } catch {
        // Continue testing other regions
      }
    }

    // Alignment verified: SSIM >= 0.82
    if (bestRegion && bestSSIM >= 0.82) {
      try {
        // Resize high-res zoomed detail to fit exactly into the verified matched region on the base canvas
        const resizedZoomOverlay = await sharp(zoomBuffer)
          .resize(bestRegion.width, bestRegion.height, { fit: 'fill' })
          .toBuffer();

        const compositeBuffer = await sharp(baseBuffer)
          .composite([
            {
              input: resizedZoomOverlay,
              left: bestRegion.left,
              top: bestRegion.top,
            },
          ])
          .jpeg({ quality: 95 })
          .toBuffer();

        return {
          isIntegrated: true,
          resultBuffer: compositeBuffer,
          confidence: Math.round(bestSSIM * 100) / 100,
          matchedRegion: bestRegion,
          warnings: ['High-resolution zoomed detail integrated into page'],
        };
      } catch (err: any) {
        console.warn(`[ZoomIntegration] Compositing failed: ${err.message}`);
      }
    }

    // Uncertain geometric alignment: preserve zoom frame as separate page
    return {
      isIntegrated: false,
      resultBuffer: zoomBuffer,
      confidence: Math.round(bestSSIM * 100) / 100 || 0.65,
      matchedRegion: bestRegion || undefined,
      warnings: ['Zoom geometric alignment uncertain; preserved as distinct page for review'],
    };
  }
}
