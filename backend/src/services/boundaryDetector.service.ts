import sharp from 'sharp';

export interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
  wasCropped: boolean;
}

export class BoundaryDetectorService {
  /**
   * Detects document boundaries (e.g. removing pure black letterboxing / pillarboxing).
   * Conservative rule: NEVER crops if boundary is uncertain or if content might be clipped.
   */
  static async detectAndCrop(imageBuffer: Buffer): Promise<{
    processedBuffer: Buffer;
    boundingBox: BoundingBox;
  }> {
    const metadata = await sharp(imageBuffer).metadata();
    const origWidth = metadata.width || 1280;
    const origHeight = metadata.height || 720;

    // Default: full frame (zero cropping)
    const fullFrameBox: BoundingBox = {
      left: 0,
      top: 0,
      width: origWidth,
      height: origHeight,
      confidence: 1.0,
      wasCropped: false,
    };

    // Analyze downsampled 320x180 grayscale map
    const sampleWidth = 320;
    const sampleHeight = Math.round((sampleWidth / origWidth) * origHeight);
    const scaleX = origWidth / sampleWidth;
    const scaleY = origHeight / sampleHeight;

    const raw = await sharp(imageBuffer)
      .resize(sampleWidth, sampleHeight, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    const W = sampleWidth;
    const H = sampleHeight;

    // Detect left pillarbox (solid black or near-black columns <= 15 on 0-255 scale)
    let leftMargin = 0;
    for (let x = 0; x < Math.floor(W * 0.3); x++) {
      let isDarkColumn = true;
      for (let y = 0; y < H; y++) {
        if (raw[y * W + x] > 20) {
          isDarkColumn = false;
          break;
        }
      }
      if (isDarkColumn) {
        leftMargin = x;
      } else {
        break;
      }
    }

    // Detect right pillarbox
    let rightMargin = 0;
    for (let x = W - 1; x >= Math.floor(W * 0.7); x--) {
      let isDarkColumn = true;
      for (let y = 0; y < H; y++) {
        if (raw[y * W + x] > 20) {
          isDarkColumn = false;
          break;
        }
      }
      if (isDarkColumn) {
        rightMargin = W - 1 - x;
      } else {
        break;
      }
    }

    // Convert margins to original coordinates
    const origLeftMargin = Math.floor(leftMargin * scaleX);
    const origRightMargin = Math.floor(rightMargin * scaleX);

    // Only crop if pillarbox is significant (> 40px on both sides, e.g. 4:3 content in 16:9 stream)
    const hasPillarbox = origLeftMargin > 40 && origRightMargin > 40;

    if (!hasPillarbox) {
      // Conservative: preserve complete original frame
      return {
        processedBuffer: imageBuffer,
        boundingBox: fullFrameBox,
      };
    }

    // Apply 12px safety buffer inwards so no slide border or text is ever clipped
    const safeLeft = Math.max(0, origLeftMargin - 12);
    const safeRight = Math.min(origWidth, origWidth - origRightMargin + 12);
    const cropWidth = safeRight - safeLeft;

    if (cropWidth < origWidth * 0.4) {
      // Uncertainty check: if cropped width is too narrow, abort and preserve original
      return {
        processedBuffer: imageBuffer,
        boundingBox: fullFrameBox,
      };
    }

    try {
      const croppedBuffer = await sharp(imageBuffer)
        .extract({
          left: safeLeft,
          top: 0,
          width: cropWidth,
          height: origHeight,
        })
        .jpeg({ quality: 92 })
        .toBuffer();

      return {
        processedBuffer: croppedBuffer,
        boundingBox: {
          left: safeLeft,
          top: 0,
          width: cropWidth,
          height: origHeight,
          confidence: 0.95,
          wasCropped: true,
        },
      };
    } catch {
      // Fallback to original
      return {
        processedBuffer: imageBuffer,
        boundingBox: fullFrameBox,
      };
    }
  }
}
