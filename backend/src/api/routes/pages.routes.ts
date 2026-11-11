import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { PageRepository } from '../../models/Page.model.js';
import { JobRepository } from '../../models/Job.model.js';
import { config } from '../../core/config.js';
import { optionalAuth, requireAuth } from '../../core/auth.middleware.js';

const router = Router();

// Row-Level Security: require auth when REQUIRE_AUTH=true, otherwise optionalAuth
const authGuard = process.env.REQUIRE_AUTH === 'true' ? requireAuth : optionalAuth;

router.use(authGuard);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Validate all :id route parameters to prevent Path Traversal and malformed queries
router.param('id', (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: `Invalid identifier format '${id}'. Must be a valid UUID.` });
  }
  next();
});

// GET /api/jobs/:id/pages - Get extracted pages for a job
router.get('/jobs/:id/pages', async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id;
    const job = await JobRepository.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job with ID ${jobId} not found` });
    }

    if (job.userId && req.user && job.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to view pages for this job' });
    }

    const pages = await PageRepository.findByJobId(jobId);
    const enriched = pages.map((p) => ({
      ...p,
      imageUrl: `/storage/${p.imagePath}?v=${p.rotation || 0}`,
    }));

    return res.json(enriched);
  } catch (error: any) {
    console.error('Error fetching pages:', error);
    return res.status(500).json({ error: 'Internal server error fetching pages' });
  }
});

// POST /api/jobs/:id/pages/reorder - Reorder pages
router.post('/jobs/:id/pages/reorder', async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id;
    const job = await JobRepository.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job with ID ${jobId} not found` });
    }

    if (job.userId && req.user && job.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to modify this job' });
    }

    const { orderedPageIds } = req.body;

    if (!Array.isArray(orderedPageIds)) {
      return res.status(400).json({ error: 'orderedPageIds must be an array of page IDs' });
    }

    const reordered = await PageRepository.reorder(jobId, orderedPageIds);
    return res.json(reordered);
  } catch (error: any) {
    console.error('Error reordering pages:', error);
    return res.status(500).json({ error: 'Internal server error reordering pages' });
  }
});

// POST /api/pages/:id/rotate - Rotate page by 90 degrees
router.post('/pages/:id/rotate', async (req: Request, res: Response) => {
  try {
    const pageId = req.params.id;
    const page = await PageRepository.findById(pageId);
    if (!page) {
      return res.status(404).json({ error: `Page ${pageId} not found` });
    }

    const job = await JobRepository.findById(page.jobId);
    if (job?.userId && req.user && job.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to rotate pages for this job' });
    }

    const newRotation = ((page.rotation || 0) + 90) % 360;
    const diskPath = path.resolve(config.storageDir, page.imagePath);

    if (fs.existsSync(diskPath)) {
      const buffer = fs.readFileSync(diskPath);
      const rotated = await sharp(buffer).rotate(90).jpeg({ quality: 95 }).toBuffer();
      fs.writeFileSync(diskPath, rotated);
    }

    const updated = await PageRepository.update(pageId, {
      rotation: newRotation,
      isEdited: true,
    });

    return res.json(updated);
  } catch (error: any) {
    console.error('Error rotating page:', error);
    return res.status(500).json({ error: 'Internal server error rotating page' });
  }
});

// PATCH /api/pages/:id - Update page metadata
router.patch('/pages/:id', async (req: Request, res: Response) => {
  try {
    const pageId = req.params.id;
    const page = await PageRepository.findById(pageId);
    if (!page) {
      return res.status(404).json({ error: `Page ${pageId} not found` });
    }

    const job = await JobRepository.findById(page.jobId);
    if (job?.userId && req.user && job.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to update pages for this job' });
    }

    const { rotation, pageNumber, isEdited, reconstructionStatus, warnings } = req.body;

    const updated = await PageRepository.update(pageId, {
      ...(rotation !== undefined && { rotation }),
      ...(pageNumber !== undefined && { pageNumber }),
      ...(isEdited !== undefined && { isEdited }),
      ...(reconstructionStatus !== undefined && { reconstructionStatus }),
      ...(warnings !== undefined && { warnings }),
    });

    if (!updated) {
      return res.status(404).json({ error: `Page ${pageId} not found` });
    }

    return res.json(updated);
  } catch (error: any) {
    console.error('Error updating page:', error);
    return res.status(500).json({ error: 'Internal server error updating page' });
  }
});

// DELETE /api/pages/:id - Delete a page
router.delete('/pages/:id', async (req: Request, res: Response) => {
  try {
    const pageId = req.params.id;
    const page = await PageRepository.findById(pageId);
    if (!page) {
      return res.status(404).json({ error: `Page with ID ${pageId} not found` });
    }

    const job = await JobRepository.findById(page.jobId);
    if (job?.userId && req.user && job.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to delete pages for this job' });
    }

    const diskPath = path.resolve(config.storageDir, page.imagePath);
    if (fs.existsSync(diskPath)) {
      try {
        fs.unlinkSync(diskPath);
      } catch {
        // ignore disk delete error
      }
    }

    const success = await PageRepository.delete(pageId);
    return res.json({ status: 'success', message: `Page ${pageId} deleted` });
  } catch (error: any) {
    console.error('Error deleting page:', error);
    return res.status(500).json({ error: 'Internal server error deleting page' });
  }
});

export default router;
