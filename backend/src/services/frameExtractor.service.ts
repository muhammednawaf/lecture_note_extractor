/**
 * Frame Extractor Service
 * Extracts frames from a local video file using fluent-ffmpeg.
 * Saves frames as JPEG images and creates CapturedFrame records in the DB.
 */

import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { config } from '../core/config.js';
import { FrameRepository } from '../models/Frame.model.js';

export interface ExtractionResult {
  totalFrames: number;
  framesDir: string;
  durationSeconds: number;
}

export class FrameExtractorService {
  /**
   * Extract frames from a video file at the specified FPS rate.
   * @param videoPath  Absolute path to the video file
   * @param jobId      UUID of the processing job
   * @param fps        Frames per second to extract (default: 1)
   * @param onProgress Optional callback with current frame count
   * @returns          Summary of extraction
   */
  static async extractFramesFromVideo(
    videoPath: string,
    jobId: string,
    fps: number = 1,
    onProgress?: (framesExtracted: number) => void
  ): Promise<ExtractionResult> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    const framesDir = path.join(config.framesDir, jobId);
    fs.mkdirSync(framesDir, { recursive: true });

    // Clean up any previously extracted frames for this job
    const existingFrames = fs.readdirSync(framesDir).filter((f) => f.endsWith('.jpg'));
    for (const f of existingFrames) {
      fs.unlinkSync(path.join(framesDir, f));
    }

    console.log(`[FrameExtractor] Starting extraction for job ${jobId} at ${fps} fps`);

    // First, probe the video to get duration
    const durationSeconds = await this.getVideoDuration(videoPath);
    console.log(`[FrameExtractor] Video duration: ${durationSeconds}s`);

    // Extract frames using ffmpeg
    await this.runFfmpegExtraction(videoPath, framesDir, fps);

    // Read the extracted frame files and sort them
    const frameFiles = fs
      .readdirSync(framesDir)
      .filter((f) => f.endsWith('.jpg'))
      .sort();

    console.log(`[FrameExtractor] Extracted ${frameFiles.length} frames for job ${jobId}`);

    // Rename ffmpeg output files to match the expected naming convention:
    // frame_000001.jpg → frame_00000_0.00s.jpg
    // This ensures disk auto-discovery in Frame.model.ts works correctly.
    const renamedFiles: string[] = [];
    for (let i = 0; i < frameFiles.length; i++) {
      const oldName = frameFiles[i];
      const timestamp = i / fps;
      const newName = `frame_${String(i).padStart(5, '0')}_${timestamp.toFixed(2)}s.jpg`;
      const oldPath = path.join(framesDir, oldName);
      const newPath = path.join(framesDir, newName);
      fs.renameSync(oldPath, newPath);
      renamedFiles.push(newName);
    }

    // Create CapturedFrame records for each renamed frame file
    for (let i = 0; i < renamedFiles.length; i++) {
      const fileName = renamedFiles[i];
      const timestamp = i / fps;
      const imagePath = `frames/${jobId}/${fileName}`;

      await FrameRepository.create({
        jobId,
        frameIndex: i,
        timestamp,
        imagePath,
      });

      if (onProgress) {
        onProgress(i + 1);
      }
    }

    return {
      totalFrames: frameFiles.length,
      framesDir,
      durationSeconds,
    };
  }

  /**
   * Get video duration in seconds using ffprobe.
   */
  private static getVideoDuration(videoPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          // If probe fails, return 0 — not critical
          console.warn(`[FrameExtractor] ffprobe error (non-fatal): ${err.message}`);
          resolve(0);
          return;
        }
        const duration = metadata?.format?.duration || 0;
        resolve(duration);
      });
    });
  }

  /**
   * Run ffmpeg to extract frames at the given fps rate.
   * Output pattern: framesDir/frame_%06d.jpg
   */
  private static runFfmpegExtraction(
    videoPath: string,
    framesDir: string,
    fps: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const outputPattern = path.join(framesDir, 'frame_%06d.jpg');

      ffmpeg(videoPath)
        .outputOptions([
          `-vf fps=${fps}`,         // Sample at given fps
          '-q:v 2',                 // High quality JPEG (1=best, 31=worst)
          '-vsync vfr',             // Variable frame rate sync to avoid duplicate frames
        ])
        .output(outputPattern)
        .on('start', (cmd) => {
          console.log(`[FrameExtractor] ffmpeg command: ${cmd}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`[FrameExtractor] ffmpeg progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log(`[FrameExtractor] ffmpeg extraction complete`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`[FrameExtractor] ffmpeg error:`, err);
          reject(new Error(`ffmpeg frame extraction failed: ${err.message}`));
        })
        .run();
    });
  }
}
