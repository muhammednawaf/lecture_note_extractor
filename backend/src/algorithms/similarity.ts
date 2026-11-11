import sharp from 'sharp';

export interface FrameHash {
  hashHex: string;
  binaryArray: number[];
}

export interface RegionalSSIMResult {
  globalSSIM: number;
  minRegionalSSIM: number;
  centerSSIM: number;
  regionalSSIMs: number[];
  hasLocalizedChange: boolean;
}

export class SimilarityAlgorithms {
  /**
   * Computes a 64-bit difference hash (dHash) from an image file path or buffer.
   * Resizes image to 9x8 grayscale, compares horizontal pixel gradients.
   */
  static async computeDHash(imageSource: string | Buffer): Promise<FrameHash> {
    const raw = await sharp(imageSource)
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    const bits: number[] = [];
    // 8 rows, 8 horizontal comparisons per row = 64 bits
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = raw[row * 9 + col];
        const right = raw[row * 9 + col + 1];
        bits.push(left > right ? 1 : 0);
      }
    }

    // Convert bits to 16-character hexadecimal string
    let hex = '';
    for (let i = 0; i < 64; i += 4) {
      const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
      hex += nibble.toString(16);
    }

    return {
      hashHex: hex,
      binaryArray: bits,
    };
  }

  /**
   * Calculates Hamming distance between two 64-bit binary hash arrays.
   * Returns a value between 0 (identical) and 64 (maximally different).
   */
  static hammingDistance(hashA: number[], hashB: number[]): number {
    let distance = 0;
    const len = Math.min(hashA.length, hashB.length);
    for (let i = 0; i < len; i++) {
      if (hashA[i] !== hashB[i]) {
        distance++;
      }
    }
    return distance;
  }

  /**
   * Computes SSIM directly between two equal-sized raw grayscale byte buffers in O(N) time.
   */
  static computeRawSSIM(rawA: Buffer, rawB: Buffer): number {
    const N = rawA.length;
    if (N === 0 || N !== rawB.length) return 0;

    const K1 = 0.01;
    const K2 = 0.03;
    const L = 255;
    const C1 = (K1 * L) ** 2; // 6.5025
    const C2 = (K2 * L) ** 2; // 58.5225

    let sumA = 0;
    let sumB = 0;
    for (let i = 0; i < N; i++) {
      sumA += rawA[i];
      sumB += rawB[i];
    }
    const meanA = sumA / N;
    const meanB = sumB / N;

    let varA = 0;
    let varB = 0;
    let covAB = 0;
    for (let i = 0; i < N; i++) {
      const diffA = rawA[i] - meanA;
      const diffB = rawB[i] - meanB;
      varA += diffA * diffA;
      varB += diffB * diffB;
      covAB += diffA * diffB;
    }
    varA /= N - 1;
    varB /= N - 1;
    covAB /= N - 1;

    const numerator = (2 * meanA * meanB + C1) * (2 * covAB + C2);
    const denominator = (meanA ** 2 + meanB ** 2 + C1) * (varA + varB + C2);

    if (denominator === 0) return 1.0;
    const ssim = numerator / denominator;
    return Math.max(0, Math.min(1, ssim));
  }

  /**
   * Computes SSIM on a specific rectangular sub-region inside raw grayscale buffers.
   * Enables high-speed regional inspection in O(blockW * blockH).
   */
  static computeSubRegionSSIM(
    rawA: Buffer,
    rawB: Buffer,
    strideW: number,
    startX: number,
    startY: number,
    blockW: number,
    blockH: number
  ): number {
    const N = blockW * blockH;
    if (N <= 1) return 1.0;

    const K1 = 0.01;
    const K2 = 0.03;
    const L = 255;
    const C1 = (K1 * L) ** 2;
    const C2 = (K2 * L) ** 2;

    let sumA = 0;
    let sumB = 0;
    for (let y = 0; y < blockH; y++) {
      const rowOffset = (startY + y) * strideW + startX;
      for (let x = 0; x < blockW; x++) {
        sumA += rawA[rowOffset + x];
        sumB += rawB[rowOffset + x];
      }
    }
    const meanA = sumA / N;
    const meanB = sumB / N;

    let varA = 0;
    let varB = 0;
    let covAB = 0;
    for (let y = 0; y < blockH; y++) {
      const rowOffset = (startY + y) * strideW + startX;
      for (let x = 0; x < blockW; x++) {
        const diffA = rawA[rowOffset + x] - meanA;
        const diffB = rawB[rowOffset + x] - meanB;
        varA += diffA * diffA;
        varB += diffB * diffB;
        covAB += diffA * diffB;
      }
    }
    varA /= N - 1;
    varB /= N - 1;
    covAB /= N - 1;

    const numerator = (2 * meanA * meanB + C1) * (2 * covAB + C2);
    const denominator = (meanA ** 2 + meanB ** 2 + C1) * (varA + varB + C2);
    if (denominator === 0) return 1.0;
    const ssim = numerator / denominator;
    return Math.max(0, Math.min(1, ssim));
  }

  /**
   * Computes 3x3 Regional SSIM between two 128x128 images.
   * Evaluates both global similarity and localized quadrant changes
   * so new handwritten derivations in margins or quadrants are never missed.
   */
  static computeRegionalSSIM(
    rawA: Buffer,
    rawB: Buffer,
    W = 128,
    H = 128
  ): RegionalSSIMResult {
    const globalSSIM = this.computeRawSSIM(rawA, rawB);
    const blockW = Math.floor(W / 3);
    const blockH = Math.floor(H / 3);

    const regionalSSIMs: number[] = [];
    let minRegionalSSIM = 1.0;

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const blockSSIM = this.computeSubRegionSSIM(
          rawA,
          rawB,
          W,
          c * blockW,
          r * blockH,
          blockW,
          blockH
        );
        regionalSSIMs.push(blockSSIM);
        if (blockSSIM < minRegionalSSIM) {
          minRegionalSSIM = blockSSIM;
        }
      }
    }

    const centerSSIM = regionalSSIMs[4]; // Center block (r=1, c=1)

    // A localized change occurs when an isolated quadrant dropped significantly relative to the rest of the page
    // (e.g. an equation or diagram was written in that section), while other sections remain consistent.
    const hasLocalizedChange =
      (minRegionalSSIM < 0.82 && globalSSIM >= 0.70 && minRegionalSSIM < globalSSIM - 0.10) ||
      (centerSSIM < 0.82 && globalSSIM >= 0.85) ||
      (globalSSIM >= 0.88 && minRegionalSSIM < 0.82);

    return {
      globalSSIM,
      minRegionalSSIM,
      centerSSIM,
      regionalSSIMs,
      hasLocalizedChange,
    };
  }

  /**
   * Computes Structural Similarity Index (SSIM) between two images.
   * Uses aspect-ratio-preserving 'contain' fit to eliminate spatial squishing/distortion.
   */
  static async computeSSIM(
    imageSourceA: string | Buffer,
    imageSourceB: string | Buffer
  ): Promise<number> {
    const targetSize = 128;
    const [rawA, rawB] = await Promise.all([
      sharp(imageSourceA)
        .resize(targetSize, targetSize, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
        .grayscale()
        .raw()
        .toBuffer(),
      sharp(imageSourceB)
        .resize(targetSize, targetSize, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
        .grayscale()
        .raw()
        .toBuffer(),
    ]);

    return this.computeRawSSIM(rawA, rawB);
  }

  /**
   * Determines whether two frames are duplicates (same page/slide).
   */
  static async areDuplicates(
    imageA: string | Buffer,
    imageB: string | Buffer
  ): Promise<{ isDuplicate: boolean; ssim: number; hammingDist: number }> {
    const [hashA, hashB] = await Promise.all([
      this.computeDHash(imageA),
      this.computeDHash(imageB),
    ]);

    const hammingDist = this.hammingDistance(hashA.binaryArray, hashB.binaryArray);
    const ssim = await this.computeSSIM(imageA, imageB);

    // Duplicate if SSIM >= 0.82 or (hammingDist <= 8 with SSIM >= 0.78)
    const isDuplicate = ssim >= 0.82 || (hammingDist <= 8 && ssim >= 0.78);

    return { isDuplicate, ssim, hammingDist };
  }

  /**
   * Fast Zoom & Sub-Region Detection:
   * Checks whether image B is a zoomed-in crop of image A, or vice versa.
   * Compares strategic sub-regions (center 60%, top 60%, bottom 60%) in < 3ms using Sharp and raw SSIM.
   */
  static async checkZoomRelation(
    imageSourceA: string | Buffer,
    imageSourceB: string | Buffer
  ): Promise<{ isZoom: boolean; widerFrame: 'A' | 'B' | 'NONE'; confidence: number }> {
    const targetSize = 128;

    const [metaA, metaB] = await Promise.all([
      sharp(imageSourceA).metadata(),
      sharp(imageSourceB).metadata(),
    ]);

    const wA = metaA.width || 640;
    const hA = metaA.height || 360;
    const wB = metaB.width || 640;
    const hB = metaB.height || 360;

    const [fullA, fullB] = await Promise.all([
      sharp(imageSourceA).resize(targetSize, targetSize, { fit: 'fill' }).grayscale().raw().toBuffer(),
      sharp(imageSourceB).resize(targetSize, targetSize, { fit: 'fill' }).grayscale().raw().toBuffer(),
    ]);

    // Helper to safely clamp extraction boxes within image boundaries
    const safeCrop = (left: number, top: number, width: number, height: number, maxW: number, maxH: number) => {
      const l = Math.max(0, Math.min(maxW - 10, left));
      const t = Math.max(0, Math.min(maxH - 10, top));
      const w = Math.max(10, Math.min(maxW - l, width));
      const h = Math.max(10, Math.min(maxH - t, height));
      return { left: l, top: t, width: w, height: h };
    };

    // Test 1: Does a sub-region of A match full B? (A is wider, B is zoomed in)
    const regionsA = [
      safeCrop(Math.round(wA * 0.15), Math.round(hA * 0.15), Math.round(wA * 0.7), Math.round(hA * 0.7), wA, hA), // center
      safeCrop(Math.round(wA * 0.05), 0, Math.round(wA * 0.9), Math.round(hA * 0.6), wA, hA), // top
      safeCrop(Math.round(wA * 0.05), Math.round(hA * 0.4), Math.round(wA * 0.9), Math.round(hA * 0.6), wA, hA), // bottom
    ];

    for (const r of regionsA) {
      const cropA = await sharp(imageSourceA)
        .extract(r)
        .resize(targetSize, targetSize, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();

      const ssim = this.computeRawSSIM(cropA, fullB);
      if (ssim >= 0.76) {
        return { isZoom: true, widerFrame: 'A', confidence: ssim };
      }
    }

    // Test 2: Does a sub-region of B match full A? (B is wider, A is zoomed in)
    const regionsB = [
      safeCrop(Math.round(wB * 0.15), Math.round(hB * 0.15), Math.round(wB * 0.7), Math.round(hB * 0.7), wB, hB),
      safeCrop(Math.round(wB * 0.05), 0, Math.round(wB * 0.9), Math.round(hB * 0.6), wB, hB),
      safeCrop(Math.round(wB * 0.05), Math.round(hB * 0.4), Math.round(wB * 0.9), Math.round(hB * 0.6), wB, hB),
    ];

    for (const r of regionsB) {
      const cropB = await sharp(imageSourceB)
        .extract(r)
        .resize(targetSize, targetSize, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();

      const ssim = this.computeRawSSIM(cropB, fullA);
      if (ssim >= 0.76) {
        return { isZoom: true, widerFrame: 'B', confidence: ssim };
      }
    }

    return { isZoom: false, widerFrame: 'NONE', confidence: 0 };
  }
}
