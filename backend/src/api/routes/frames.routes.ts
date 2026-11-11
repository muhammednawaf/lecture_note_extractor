import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { config } from '../../core/config.js';
import { JobRepository } from '../../models/Job.model.js';
import { FrameRepository } from '../../models/Frame.model.js';

let sharp: any = null;
try {
  const sharpModule = await import('sharp');
  sharp = sharpModule.default || sharpModule;
} catch (e) {
  console.warn('[Sharp] Sharp not compiled, continuing with direct buffer storage.');
}

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Validate all :id route parameters to prevent Path Traversal
router.param('id', (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: `Invalid job identifier format '${id}'. Must be a valid UUID.` });
  }
  next();
});

const upload = multer({
  limits: { fileSize: config.maxFrameSizeBytes },
  storage: multer.memoryStorage(),
});

// POST /api/jobs/:id/frames - Upload captured frame
router.post('/:id/frames', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id;
    const job = await JobRepository.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job with ID ${jobId} not found` });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const timestamp = parseFloat(req.body.timestamp || '0');
    const frameIndex = parseInt(req.body.frameIndex || '0', 10);

    const jobFramesDir = path.join(config.framesDir, jobId);
    if (!fs.existsSync(jobFramesDir)) {
      fs.mkdirSync(jobFramesDir, { recursive: true });
    }

    const paddedIndex = String(frameIndex).padStart(5, '0');
    const filename = `frame_${paddedIndex}_${timestamp.toFixed(2)}s.jpg`;
    const targetFilePath = path.join(jobFramesDir, filename);

    let width: number | undefined;
    let height: number | undefined;

    if (sharp) {
      try {
        const metadata = await sharp(req.file.buffer).metadata();
        width = metadata.width;
        height = metadata.height;
        await sharp(req.file.buffer)
          .jpeg({ quality: 90 })
          .toFile(targetFilePath);
      } catch (err) {
        fs.writeFileSync(targetFilePath, req.file.buffer);
      }
    } else {
      fs.writeFileSync(targetFilePath, req.file.buffer);
    }

    const relativeImagePath = `frames/${jobId}/${filename}`;

    const frame = await FrameRepository.create({
      jobId,
      frameIndex,
      timestamp,
      imagePath: relativeImagePath,
      width,
      height,
      fileSizeBytes: req.file.size,
    });

    const totalFrames = await FrameRepository.countByJobId(jobId);
    await JobRepository.update(jobId, {
      totalFrames,
      ...(job.status === 'CREATED' && { status: 'CAPTURING' }),
    });

    return res.status(201).json({
      ...frame,
      imageUrl: `/storage/${relativeImagePath}`,
    });
  } catch (error: any) {
    console.error('Error uploading frame:', error);
    return res.status(500).json({ error: 'Internal server error uploading frame' });
  }
});

// GET /api/jobs/:id/frames - Get captured frames for a job
router.get('/:id/frames', async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id;
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const frames = await FrameRepository.findByJobId(jobId, limit);

    const enriched = frames.map((f) => ({
      ...f,
      imageUrl: `/storage/${f.imagePath}`,
    }));

    return res.json(enriched);
  } catch (error: any) {
    console.error('Error fetching frames:', error);
    return res.status(500).json({ error: 'Internal server error fetching frames' });
  }
});

export default router;
