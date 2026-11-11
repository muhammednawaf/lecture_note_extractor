import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { PdfGeneratorService } from '../../services/pdfGenerator.service.js';
import { JobRepository } from '../../models/Job.model.js';
import { config } from '../../core/config.js';
import { heavyComputeRateLimiter, sanitizeHeaderFilename } from '../../core/security.middleware.js';
import { optionalAuth, requireAuth } from '../../core/auth.middleware.js';

const router = Router();

// Row-Level Security: require auth when REQUIRE_AUTH=true, otherwise optionalAuth
const authGuard = process.env.REQUIRE_AUTH === 'true' ? requireAuth : optionalAuth;

router.use(authGuard);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Validate all :id route parameters to prevent Path Traversal
router.param('id', (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: `Invalid job identifier format '${id}'. Must be a valid UUID.` });
  }
  next();
});

// POST /api/jobs/:id/export - Generate compiled PDF from extracted pages
router.post('/jobs/:id/export', heavyComputeRateLimiter, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id;
    const job = await JobRepository.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job with ID ${jobId} not found` });
    }

    if (job.userId && req.user && job.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to export this job' });
    }

    const { title, pageSize, pageOrientation, includePageNumbers, margin, onlyVerified } = req.body;

    const result = await PdfGeneratorService.generatePdf(jobId, {
      title,
      pageSize,
      pageOrientation,
      includePageNumbers,
      margin,
      onlyVerified: onlyVerified === true || onlyVerified === 'true',
    });

    // Provide absolute downloadUrl pointing to the backend host so cross-origin frontends (e.g. Vercel) don't navigate locally
    const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host = req.get('host') || 'localhost:8000';
    const absoluteDownloadUrl = `${protocol}://${host}/api/jobs/${jobId}/download`;

    return res.json({
      status: 'success',
      ...result,
      downloadUrl: absoluteDownloadUrl,
    });
  } catch (error: any) {
    console.error('Error generating PDF:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate PDF' });
  }
});

// GET /api/jobs/:id/download - Stream and download generated PDF
router.get('/jobs/:id/download', async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id;
    const job = await JobRepository.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job with ID ${jobId} not found` });
    }

    if (job.userId && req.user && job.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to download this PDF' });
    }

    const jobPdfsDir = path.join(config.pdfsDir, jobId);

    if (!fs.existsSync(jobPdfsDir)) {
      return res.status(404).json({ error: 'No exported PDF found for this job. Generate export first.' });
    }

    const files = fs.readdirSync(jobPdfsDir).filter((f) => f.endsWith('.pdf'));
    if (files.length === 0) {
      return res.status(404).json({ error: 'No exported PDF found for this job.' });
    }

    // Pick the most recent PDF
    const latestPdf = files[files.length - 1];
    const filePath = path.join(jobPdfsDir, latestPdf);

    // Defense-in-depth: assert filePath is strictly inside config.pdfsDir
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(config.pdfsDir))) {
      return res.status(403).json({ error: 'Access denied: Path traversal detected.' });
    }

    const safeFilename = sanitizeHeaderFilename(latestPdf);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    return res.download(filePath, safeFilename);
  } catch (error: any) {
    console.error('Error downloading PDF:', error);
    return res.status(500).json({ error: 'Internal server error downloading PDF' });
  }
});

export default router;
