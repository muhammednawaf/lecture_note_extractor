/**
 * Video Downloader Service
 * Downloads YouTube videos using @distube/ytdl-core.
 * The downloaded file is saved to storage/videos/{jobId}/video.mp4
 * and can then be fed into frameExtractor.service.ts for frame sampling.
 */

import { Ytdl, parseVideoId, Quality, ProgressEvent } from '@distube/ytdl-core';
import fs from 'fs';
import path from 'path';
import { config } from '../core/config.js';

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

const ytdlClient = new Ytdl();

export class VideoDownloaderService {
  /**
   * Validate if a given string is a valid YouTube URL or video ID.
   */
  static isValidYouTubeUrl(url: string): boolean {
    return Boolean(parseVideoId(url));
  }

  /**
   * Download a YouTube video to a local file.
   * @param url        Full YouTube URL (e.g. https://www.youtube.com/watch?v=...)
   * @param jobId      UUID of the processing job (used for the output directory)
   * @param onProgress Optional callback to track download progress (0-100)
   * @returns          Absolute path to the downloaded video file
   */
  static async downloadYouTubeVideo(
    url: string,
    jobId: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<string> {
    const videoId = parseVideoId(url);
    if (!videoId) {
      throw new Error(`Invalid YouTube URL: ${url}`);
    }

    // Ensure the output directory exists
    const videosDir = path.join(config.storageDir, 'videos', jobId);
    fs.mkdirSync(videosDir, { recursive: true });

    const outputPath = path.join(videosDir, 'video.mp4');

    // If already downloaded, skip
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      console.log(`[VideoDownloader] Video already exists for job ${jobId}, skipping download.`);
      return outputPath;
    }

    console.log(`[VideoDownloader] Starting download for job ${jobId}: ${url}`);

    return new Promise((resolve, reject) => {
      let isSettled = false;

      const safeReject = (err: Error) => {
        if (isSettled) return;
        isSettled = true;
        if (fs.existsSync(outputPath)) {
          try {
            fs.unlinkSync(outputPath);
          } catch {
            // ignore cleanup error
          }
        }
        reject(err);
      };

      const safeResolve = (p: string) => {
        if (isSettled) return;
        isSettled = true;
        resolve(p);
      };

      const stream = ytdlClient.download(url, {
        quality: Quality.HighestVideo,
        filter: (f) => Boolean(f.hasVideo),
        onProgress: (event: ProgressEvent) => {
          if (event.total && event.total > 0 && onProgress) {
            const percent = Math.min(100, Math.round((event.downloaded / event.total) * 100));
            onProgress({
              downloaded: event.downloaded,
              total: event.total,
              percent,
            });
          }
        },
      });

      stream.on('error', (err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[VideoDownloader] Download error for job ${jobId}:`, errorMsg);
        safeReject(new Error(`YouTube download failed: ${errorMsg}`));
      });

      const writeStream = fs.createWriteStream(outputPath);

      writeStream.on('error', (err: Error) => {
        console.error(`[VideoDownloader] File write error for job ${jobId}:`, err);
        safeReject(new Error(`Failed to write video file: ${err.message}`));
      });

      writeStream.on('finish', () => {
        const fileSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
        if (fileSize === 0) {
          safeReject(new Error('Downloaded file is empty — download may have failed.'));
          return;
        }
        console.log(
          `[VideoDownloader] Download complete for job ${jobId}: ${Math.round(fileSize / 1024 / 1024)} MB`
        );
        safeResolve(outputPath);
      });

      stream.pipe(writeStream);
    });
  }

  /**
   * Fetch basic info about a YouTube video without downloading it.
   */
  static async getVideoInfo(url: string): Promise<{ title: string; duration: number }> {
    const videoId = parseVideoId(url);
    if (!videoId) {
      throw new Error(`Invalid YouTube URL: ${url}`);
    }

    try {
      const info = await ytdlClient.getInfo(url);
      const details = info.videoDetails;
      return {
        title: details.title || 'YouTube Lecture',
        duration: details.lengthSeconds || 0,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch video info: ${errorMsg}`);
    }
  }

  /**
   * Save an uploaded video file (Buffer or temporary file path) to the job's storage directory.
   */
  static saveUploadedVideo(jobId: string, input: Buffer | string, originalName: string): string {
    const videosDir = path.join(config.storageDir, 'videos', jobId);
    fs.mkdirSync(videosDir, { recursive: true });

    const ext = path.extname(originalName).toLowerCase() || '.mp4';
    const outputPath = path.join(videosDir, `video${ext}`);

    if (typeof input === 'string') {
      try {
        fs.renameSync(input, outputPath);
      } catch {
        fs.copyFileSync(input, outputPath);
        try {
          fs.unlinkSync(input);
        } catch {
          // ignore
        }
      }
    } else {
      fs.writeFileSync(outputPath, input);
    }

    console.log(`[VideoDownloader] Saved uploaded video for job ${jobId}: ${outputPath}`);
    return outputPath;
  }
}
