import sharp from 'sharp';

export interface QualityMetrics {
  sharpness: number;
  contrast: number;
  overallScore: number;
  isBlurry: boolean;
  width: number;
  height: number;
}

export class QualityScoreAlgorithm {
  /**
   * Computes image quality score using Laplacian variance for sharpness/motion blur
   * and pixel intensity standard deviation for text contrast.
   */
  static async computeQuality(imageSource: string | Buffer): Promise<QualityMetrics> {
    // Resize down to max 640 width to evaluate quality quickly while preserving text edges
    const image = sharp(imageSource);
    const metadata = await image.metadata();
    const origWidth = metadata.width || 1280;
    const origHeight = metadata.height || 720;

    const sampleWidth = Math.min(640, origWidth);
    const sampleHeight = Math.round((sampleWidth / origWidth) * origHeight);

    const rawGrayscale = await sharp(imageSource)
      .resize(sampleWidth, sampleHeight, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    const W = sampleWidth;
    const H = sampleHeight;
    const totalPixels = W * H;

    // 1. Compute Contrast (Standard Deviation of Grayscale Pixels)
    let sum = 0;
    for (let i = 0; i < totalPixels; i++) {
      sum += rawGrayscale[i];
    }
    const mean = sum / totalPixels;

    let varSum = 0;
    for (let i = 0; i < totalPixels; i++) {
      const diff = rawGrayscale[i] - mean;
      varSum += diff * diff;
    }
    const contrast = Math.sqrt(varSum / totalPixels);

    // 2. Discrete Laplacian 3x3 Convolution (Sharpness / Focus measure)
    // Kernel:
    // [  0,  1,  0 ]
    // [  1, -4,  1 ]
    // [  0,  1,  0 ]
    let laplacianSum = 0;
    let laplacianSqSum = 0;
    let laplacianCount = 0;

    for (let y = 1; y < H - 1; y++) {
      const rowOffset = y * W;
      for (let x = 1; x < W - 1; x++) {
        const center = rawGrayscale[rowOffset + x];
        const up = rawGrayscale[(y - 1) * W + x];
        const down = rawGrayscale[(y + 1) * W + x];
        const left = rawGrayscale[rowOffset + x - 1];
        const right = rawGrayscale[rowOffset + x + 1];

        const lap = up + down + left + right - 4 * center;
        laplacianSum += lap;
        laplacianSqSum += lap * lap;
        laplacianCount++;
      }
    }

    const lapMean = laplacianSum / laplacianCount;
    const laplacianVariance = laplacianSqSum / laplacianCount - lapMean * lapMean;

    // 3. Normalized Overall Quality Score (0.0 to 1.0)
    // Typical lecture slide Laplacian variance ranges from ~20 (blurry) to ~500+ (sharp crisp text)
    const normalizedSharpness = Math.min(1.0, Math.log10(Math.max(1, laplacianVariance)) / 3.0);
    const normalizedContrast = Math.min(1.0, contrast / 80.0);

    const overallScore = Math.max(
      0.0,
      Math.min(1.0, 0.7 * normalizedSharpness + 0.3 * normalizedContrast)
    );

    const isBlurry = laplacianVariance < 25.0;

    return {
      sharpness: Math.round(laplacianVariance * 10) / 10,
      contrast: Math.round(contrast * 10) / 10,
      overallScore: Math.round(overallScore * 1000) / 1000,
      isBlurry,
      width: origWidth,
      height: origHeight,
    };
  }
}
