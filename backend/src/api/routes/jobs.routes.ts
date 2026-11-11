import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { JobRepository } from '../../models/Job.model.js';
import { PageDetectorService } from '../../services/pageDetector.service.js';
import { VideoDownloaderService } from '../../services/videoDownloader.service.js';
import { FrameExtractorService } from '../../services/frameExtractor.service.js';
import { config } from '../../core/config.js';
import { heavyComputeRateLimiter, validateYouTubeUrlInput } from '../../core/security.middleware.js';
import { optionalAuth, requireAuth } from '../../core/auth.middleware.js';

const router = Router();

// Row-Level Security: require auth when REQUIRE_AUTH=true, otherwise optionalAuth
const authGuard = process.env.REQUIRE_AUTH === 'true' ? requireAuth : optionalAuth;

router.use(authGuard);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Validate all :id route parameters to prevent Path Traversal and malformed queries
router.param('id', (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: `Invalid job identifier format '${id}'. Must be a valid UUID.` });
  }
  next();
});

// Multer config for video file uploads (streamed directly to disk to prevent Node heap exhaustion)
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(config.tempDir)) {
        fs.mkdirSync(config.tempDir, { recursive: true });
      }
      cb(null, config.tempDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
      cb(null, `upload-${Date.now()}-${uuidv4()}${ext}`);
    },
  }),
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1 GB max
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported video format: ${ext}. Allowed: ${allowed.join(', ')}`));
    }
  },
});

// POST /api/jobs - Create a new extraction job
// Accepts both YouTube URL jobs and direct upload jobs (youtubeUrl is optional)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { youtubeUrl, videoTitle, sourceType } = req.body;

    // For UPLOAD jobs, youtubeUrl is not required
    const resolvedSourceType: 'YOUTUBE' | 'UPLOAD' =
      sourceType === 'UPLOAD' ? 'UPLOAD' : youtubeUrl ? 'YOUTUBE' : 'UPLOAD';

    if (resolvedSourceType === 'YOUTUBE') {
      const urlCheck = validateYouTubeUrlInput(youtubeUrl);
      if (!urlCheck.isValid) {
        return res.status(400).json({ error: urlCheck.error });
      }
    }

    const job = await JobRepository.create({
      userId: req.user?.id,
      youtubeUrl: youtubeUrl?.trim() || '',
      videoTitle: videoTitle || (resolvedSourceType === 'YOUTUBE' ? 'YouTube Lecture' : 'Uploaded Lecture'),
      sourceType: resolvedSourceType,
    });

    return res.status(201).json(job);
  } catch (error: any) {
    console.error('Error creating job:', error);
    return res.status(500).json({ error: 'Internal server error creating job' });
  }
});

// POST /api/jobs/:id/extract - Download YouTube video and extract frames server-side
// Runs asynchronously; frontend should poll GET /api/jobs/:id for status
router.post('/:id/extract', heavyComputeRateLimiter, async (req: Request, res: Response) => {
  const jobId = req.params.id;

  try {
    const job = await JobRepository.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job ${jobId} not found` });
    }

    if (job.userId && req.user && job.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to access this job' });
    }

    if (!job.youtubeUrl) {
      return res.status(400).json({ error: 'Job has no YouTube URL to extract from' });
    }

    const rawFps: number = typeof req.body.fps === 'number' ? req.body.fps : parseFloat(req.body.fps);
    const fps = Math.min(Math.max(isNaN(rawFps) ? 1 : rawFps, 0.1), 5);

    // Respond immediately — extraction runs in the background
    res.json({
      status: 'started',
      jobId,
      message: 'YouTube video download and frame extraction started. Poll /api/jobs/:id for progress.',
    });

    // Run async (don't await — already responded)
    setImmediate(async () => {
      try {
        // Phase 1: Download
        await JobRepository.update(jobId, { status: 'DOWNLOADING' });
        console.log(`[Jobs] Downloading YouTube video for job ${jobId}`);

        const videoPath = await VideoDownloaderService.downloadYouTubeVideo(
          job.youtubeUrl,
          jobId,
          (progress) => {
            console.log(`[Jobs] Download progress: ${progress.percent}%`);
          }
        );

        // Phase 2: Extract frames
        await JobRepository.update(jobId, { status: 'EXTRACTING' });
        console.log(`[Jobs] Extracting frames for job ${jobId}`);

        const result = await FrameExtractorService.extractFramesFromVideo(
          videoPath,
          jobId,
          fps,
          (count) => {
            if (count % 10 === 0) {
              JobRepository.update(jobId, { totalFrames: count }).catch(() => { });
            }
          }
        );

        // Phase 3: Automatically execute page detection & duplicate removal pipeline
        await JobRepository.update(jobId, {
          status: 'PROCESSING',
          totalFrames: result.totalFrames,
        });
        console.log(`[Jobs] Auto-running page detection pipeline for job ${jobId}`);

        const pipelineRes = await PageDetectorService.processJob(jobId);
        console.log(
          `[Jobs] Processing complete for job ${jobId}: ${pipelineRes.finalPagesExtracted} pages generated.`
        );
      } catch (err: any) {
        console.error(`[Jobs] Extraction/processing failed for job ${jobId}:`, err);
        await JobRepository.update(jobId, { status: 'FAILED' }).catch(() => { });
      }
    });

    return;
  } catch (error: any) {
    console.error('Error starting extraction:', error);
    return res.status(500).json({ error: `Failed to start extraction: ${error.message}` });
  }
});

// POST /api/jobs/:id/upload-video - Accept uploaded video file, then extract frames
router.post(
  '/:id/upload-video',
  heavyComputeRateLimiter,
  (req, res, next) => {
    videoUpload.single('video')(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'Video file too large. Maximum supported upload size is 1 GB.' });
        }
        return res.status(400).json({ error: err.message || 'Video upload error' });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
  const jobId = req.params.id;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided. Use multipart/form-data with field name "video".' });
    }

    const job = await JobRepository.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job ${jobId} not found` });
    }

    if (job.userId && req.user && job.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to access this job' });
    }

    const rawFps: number = req.body.fps ? parseFloat(req.body.fps) : 1;
    const fps = Math.min(Math.max(isNaN(rawFps) ? 1 : rawFps, 0.1), 5);

    // Save the uploaded file (disk streamed or buffer fallback)
    const videoPath = VideoDownloaderService.saveUploadedVideo(
      jobId,
      req.file.path || req.file.buffer,
      req.file.originalname
    );

    // Respond immediately — extraction runs in background
    res.json({
      status: 'started',
      jobId,
      message: 'Video uploaded and frame extraction started. Poll /api/jobs/:id for progress.',
    });

    // Run async
    setImmediate(async () => {
      try {
        await JobRepository.update(jobId, { status: 'EXTRACTING', videoFilePath: videoPath });
        console.log(`[Jobs] Extracting frames from uploaded video for job ${jobId}`);

        const result = await FrameExtractorService.extractFramesFromVideo(
          videoPath,
          jobId,
          fps,
          (count) => {
            if (count % 10 === 0) {
              JobRepository.update(jobId, { totalFrames: count }).catch(() => { });
            }
          }
        );

        // Phase 3: Automatically execute page detection & duplicate removal pipeline
        await JobRepository.update(jobId, {
          status: 'PROCESSING',
          totalFrames: result.totalFrames,
        });
        console.log(`[Jobs] Auto-running page detection pipeline for job ${jobId}`);

        const pipelineRes = await PageDetectorService.processJob(jobId);
        console.log(
          `[Jobs] Processing complete for job ${jobId}: ${pipelineRes.finalPagesExtracted} pages generated.`
        );
      } catch (err: any) {
        console.error(`[Jobs] Frame extraction/processing failed for job ${jobId}:`, err);
        await JobRepository.update(jobId, { status: 'FAILED' }).catch(() => { });
      }
    });

    return;
  } catch (error: any) {
    console.error('Error handling video upload:', error);
    return res.status(500).json({ error: `Video upload failed: ${error.message}` });
  }
});

// POST /api/jobs/:id/process - Execute Phase 2-5 Detection & Reconstruction Pipeline
router.post('/:id/process', heavyComputeRateLimiter, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id;
    const job = await JobRepository.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job with ID ${jobId} not found` });
    }

    if (job.userId && req.user && job.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to process this job' });
    }

    const results = await PageDetectorService.processJob(jobId);
    return res.json({
      status: 'success',
      ...results,
    });
  } catch (error: any) {
    console.error('Error executing detection pipeline:', error);
    return res.status(500).json({ error: `Processing error: ${error.message}` });
  }
});

// GET /api/jobs/:id - Get job by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const job = await JobRepository.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: `Job with ID ${req.params.id} not found` });
    }
    if (job.userId && req.user && job.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to view this job' });
    }
    return res.json(job);
  } catch (error: any) {
    console.error('Error fetching job:', error);
    return res.status(500).json({ error: 'Internal server error fetching job' });
  }
});

// PATCH /api/jobs/:id - Update job
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const job = await JobRepository.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: `Job with ID ${req.params.id} not found` });
    }
    if (job.userId && req.user && job.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to update this job' });
    }

    const { status, videoTitle } = req.body;
    const updated = await JobRepository.update(req.params.id, {
      ...(status && { status }),
      ...(videoTitle && { videoTitle }),
    });

    if (!updated) {
      return res.status(404).json({ error: `Job with ID ${req.params.id} not found` });
    }

    return res.json(updated);
  } catch (error: any) {
    console.error('Error updating job:', error);
    return res.status(500).json({ error: 'Internal server error updating job' });
  }
});

// GET /api/jobs - List recent jobs (scoped to authenticated user)
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const jobs = await JobRepository.list({ userId: req.user?.id, limit });
    return res.json(jobs);
  } catch (error: any) {
    console.error('Error listing jobs:', error);
    return res.status(500).json({ error: 'Internal server error listing jobs' });
  }
});

export default router;
