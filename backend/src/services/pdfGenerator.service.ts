import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { PageRepository } from '../models/Page.model.js';
import { JobRepository } from '../models/Job.model.js';
import { config } from '../core/config.js';

export interface PdfExportOptions {
  title?: string;
  pageSize?: 'A4' | 'LETTER' | 'ORIGINAL';
  pageOrientation?: 'auto' | 'portrait' | 'landscape';
  includePageNumbers?: boolean;
  margin?: number; // margin in points
  onlyVerified?: boolean; // When true, filters out unverified / needs_review pages
}

export interface GeneratedPdfResult {
  jobId: string;
  filename: string;
  filePath: string;
  downloadUrl: string;
  pageCount: number;
  fileSizeBytes: number;
  verifiedOnly: boolean;
}

export class PdfGeneratorService {
  /**
   * Compiles the approved, ordered extracted lecture pages into a clean,
   * high-resolution PDF document preserving exact aspect ratios.
   * Supports filtering for verified pages only to prevent uncertain captures in notes.
   */
  static async generatePdf(
    jobId: string,
    options: PdfExportOptions = {}
  ): Promise<GeneratedPdfResult> {
    const job = await JobRepository.findById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    let pages = await PageRepository.findByJobId(jobId);
    if (pages.length === 0) {
      throw new Error(`No extracted pages found for job ${jobId}`);
    }

    // Filter for verified pages when requested
    const shouldFilterVerified = options.onlyVerified === true;
    if (shouldFilterVerified) {
      const verifiedPages = pages.filter(
        (p) =>
          p.reconstructionStatus === 'VERIFIED' ||
          (!p.reconstructionStatus && p.confidence >= 0.85 && p.qualityScore >= 0.70)
      );

      if (verifiedPages.length === 0) {
        throw new Error(
          `No verified pages found for job ${jobId}. Please review and mark pages as verified in the review grid before exporting, or uncheck "Only verified pages".`
        );
      }
      pages = verifiedPages;
    }

    const docTitle = options.title || job.videoTitle || 'Lecture Notes';
    const pageSize = options.pageSize || 'A4';
    const orientation = options.pageOrientation || 'auto';
    const includePageNumbers = options.includePageNumbers !== false;
    const margin = options.margin !== undefined ? options.margin : 18; // 18 points (~0.25 inch)

    // Standard paper sizes in PDF points (72 points per inch)
    const STANDARD_SIZES = {
      A4: { width: 595.28, height: 841.89 },
      LETTER: { width: 612.0, height: 792.0 },
    };

    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(docTitle);
    pdfDoc.setAuthor('Video2PDF Intelligent Extractor');
    pdfDoc.setCreator('Video2PDF (Node.js & TypeScript)');

    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      let diskPath = path.resolve(config.storageDir, page.imagePath);

      if (!fs.existsSync(diskPath)) {
        const cleaned = page.imagePath.replace(/^[/\\]+/, '').replace(/^storage[/\\]+/, '');
        const candidate = path.resolve(config.storageDir, cleaned);
        if (fs.existsSync(candidate)) {
          diskPath = candidate;
        } else {
          const directPagesPath = path.join(config.pagesDir, page.jobId, path.basename(page.imagePath));
          if (fs.existsSync(directPagesPath)) {
            diskPath = directPagesPath;
          }
        }
      }

      if (!fs.existsSync(diskPath)) {
        console.warn(`[PdfGenerator] Page image missing from disk: ${diskPath} (stored imagePath: ${page.imagePath})`);
        continue;
      }

      let imageBuffer: Buffer = fs.readFileSync(diskPath);

      // Apply rotation if user rotated page in review screen
      if (page.rotation && page.rotation % 360 !== 0) {
        imageBuffer = Buffer.from(
          await sharp(imageBuffer).rotate(page.rotation).jpeg({ quality: 95 }).toBuffer()
        );
      }

      // Ensure bytes start at offset 0 of ArrayBuffer for pdf-lib compatibility
      const standaloneBytes = new Uint8Array(imageBuffer.length);
      standaloneBytes.set(imageBuffer);

      // Embed JPEG into PDF
      const embeddedImage = await pdfDoc.embedJpg(standaloneBytes);
      const imgWidth = embeddedImage.width;
      const imgHeight = embeddedImage.height;
      const isImageLandscape = imgWidth >= imgHeight;

      let pageWidth = 0;
      let pageHeight = 0;

      if (pageSize === 'ORIGINAL') {
        pageWidth = imgWidth + margin * 2;
        pageHeight = imgHeight + margin * 2 + (includePageNumbers ? 20 : 0);
      } else {
        const base = STANDARD_SIZES[pageSize];
        let useLandscape = false;
        if (orientation === 'landscape') useLandscape = true;
        else if (orientation === 'portrait') useLandscape = false;
        else useLandscape = isImageLandscape;

        pageWidth = useLandscape ? base.height : base.width;
        pageHeight = useLandscape ? base.width : base.height;
      }

      const pdfPage = pdfDoc.addPage([pageWidth, pageHeight]);

      // Calculate drawing dimensions preserving 100% aspect ratio
      const footerSpace = includePageNumbers ? 24 : 0;
      const availWidth = pageWidth - margin * 2;
      const availHeight = pageHeight - margin * 2 - footerSpace;

      const scale = Math.min(availWidth / imgWidth, availHeight / imgHeight);
      const drawWidth = imgWidth * scale;
      const drawHeight = imgHeight * scale;

      // Center the image horizontally and vertically
      const drawX = margin + (availWidth - drawWidth) / 2;
      const drawY = margin + footerSpace + (availHeight - drawHeight) / 2;

      pdfPage.drawImage(embeddedImage, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight,
      });

      // Footer page numbering
      if (includePageNumbers) {
        const pageText = `Page ${i + 1} of ${pages.length}`;
        const fontSize = 9;
        const textWidth = helveticaFont.widthOfTextAtSize(pageText, fontSize);
        const textX = (pageWidth - textWidth) / 2;
        const textY = margin + 4;

        pdfPage.drawText(pageText, {
          x: textX,
          y: textY,
          size: fontSize,
          font: helveticaFont,
          color: rgb(0.45, 0.45, 0.45),
        });
      }
    }

    if (pdfDoc.getPageCount() === 0) {
      throw new Error(
        `PDF generation produced 0 pages. None of the ${pages.length} page images could be loaded from disk for job ${jobId}.`
      );
    }

    const pdfBytes = await pdfDoc.save();

    // Ensure output directory exists
    const jobPdfsDir = path.join(config.pdfsDir, jobId);
    if (!fs.existsSync(jobPdfsDir)) {
      fs.mkdirSync(jobPdfsDir, { recursive: true });
    }

    const cleanTitle = docTitle.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    const filename = `${cleanTitle || 'lecture_notes'}.pdf`;
    const targetFilePath = path.join(jobPdfsDir, filename);

    fs.writeFileSync(targetFilePath, Buffer.from(pdfBytes));

    const downloadUrl = `/api/jobs/${jobId}/download`;

    return {
      jobId,
      filename,
      filePath: targetFilePath,
      downloadUrl,
      pageCount: pdfDoc.getPageCount(),
      fileSizeBytes: pdfBytes.length,
      verifiedOnly: shouldFilterVerified,
    };
  }
}
