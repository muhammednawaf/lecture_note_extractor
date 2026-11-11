/**
 * Video Downloader Service
 * Downloads YouTube videos using @distube/ytdl-core.
 * The downloaded file is saved to storage/videos/{jobId}/video.mp4
 * and can then be fed into frameExtractor.service.ts for frame sampling.
 */

import {
  Ytdl,
  Client,
  parseVideoId,
  Quality,
  ProgressEvent,
  createPoTokenProvider,
} from '@distube/ytdl-core';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { config } from '../core/config.js';

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

let poTokenProviderInstance: any = null;
let poTokenPromise: Promise<any> | null = null;
let ytdlClientInstance: Ytdl | null = null;

/**
 * Configure Ytdl client instance with BotGuard PO token provider and multi-client fallback.
 * PO token provider mints proof-of-origin tokens in a worker thread, bypassing YouTube bot-check walls.
 */
async function getYtdlClient(): Promise<Ytdl> {
  if (ytdlClientInstance) return ytdlClientInstance;

  const cookie = process.env.YOUTUBE_COOKIE || undefined;

  let getPoToken: any = undefined;
  try {
    if (!poTokenProviderInstance) {
      if (!poTokenPromise) {
        poTokenPromise = createPoTokenProvider().catch((err) => {
          console.warn('[VideoDownloader] Note: PO token provider background minting unavailable:', err?.message || err);
          return null;
        });
      }
      poTokenProviderInstance = await poTokenPromise;
    }
    if (poTokenProviderInstance) {
      getPoToken = poTokenProviderInstance;
    }
  } catch (err: any) {
    console.warn('[VideoDownloader] Note: PO token provider skipped:', err?.message || err);
  }

  ytdlClientInstance = new Ytdl({
    cookie,
    getPoToken,
    clients: [
      Client.Mweb,
      Client.Tv,
      Client.WebEmbedded,
      Client.VisionOS,
      Client.WebCreator,
      Client.WebMusic,
    ],
  });

  return ytdlClientInstance;
}

/**
 * Check if the yt-dlp CLI binary is available on the operating system.
 */
function isYtDlpAvailable(): boolean {
  try {
    return fs.existsSync('/usr/local/bin/yt-dlp') || fs.existsSync('/usr/bin/yt-dlp');
  } catch {
    return false;
  }
}

/**
 * Download YouTube video using system yt-dlp binary (resilient fallback for cloud environments).
 */
function downloadWithYtDlp(
  url: string,
  outputPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`[VideoDownloader] Attempting resilient download with yt-dlp for: ${url}`);

    const args = [
      '--no-playlist',
      '-f',
      'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format',
      'mp4',
      '-o',
      outputPath,
      '--newline',
    ];

    if (process.env.YOUTUBE_COOKIE) {
      // If cookie string is provided, yt-dlp can accept --add-header
      args.push('--add-header', `Cookie:${process.env.YOUTUBE_COOKIE}`);
    }

    args.push(url);

    const proc = spawn('yt-dlp', args);
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const line = data.toString();
      const match = line.match(/\[download\]\s+([\d.]+)%/);
      if (match && onProgress) {
        const percent = Math.min(100, Math.round(parseFloat(match[1])));
        onProgress({ downloaded: percent, total: 100, percent });
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        console.log(`[VideoDownloader] yt-dlp download completed successfully.`);
        resolve(outputPath);
      } else {
        reject(new Error(`yt-dlp process exited with code ${code}: ${stderr || 'Unknown error'}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

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

    // Engine 1: Primary Ytdl client with BotGuard Proof-of-Origin token minting
    try {
      const client = await getYtdlClient();
      return await new Promise<string>((resolve, reject) => {
        let isSettled = false;

        const safeReject = (err: Error) => {
          if (isSettled) return;
          isSettled = true;
          if (fs.existsSync(outputPath)) {
            try {
              fs.unlinkSync(outputPath);
            } catch {
              // ignore
            }
          }
          reject(err);
        };

        const safeResolve = (p: string) => {
          if (isSettled) return;
          isSettled = true;
          resolve(p);
        };

        let stream: any;
        try {
          stream = client.download(url, {
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
        } catch (err: unknown) {
          return safeReject(err instanceof Error ? err : new Error(String(err)));
        }

        stream.on('error', (err: unknown) => {
          safeReject(err instanceof Error ? err : new Error(String(err)));
        });

        const writeStream = fs.createWriteStream(outputPath);

        writeStream.on('error', (err: Error) => {
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
    } catch (primaryErr: any) {
      console.warn(
        `[VideoDownloader] Primary ytdl engine failed for job ${jobId}:`,
        primaryErr?.message || primaryErr
      );

      // Engine 2: Resilient yt-dlp fallback if installed in container
      if (isYtDlpAvailable()) {
        try {
          console.log(`[VideoDownloader] Falling back to yt-dlp for job ${jobId}...`);
          return await downloadWithYtDlp(url, outputPath, onProgress);
        } catch (ytDlpErr: any) {
          console.error(`[VideoDownloader] yt-dlp fallback also failed for job ${jobId}:`, ytDlpErr?.message);
        }
      }

      const rawMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      let userMsg = rawMsg;
      if (
        rawMsg.includes("Sign in to confirm you're not a bot") ||
        rawMsg.includes('bot') ||
        rawMsg.includes('Sign in') ||
        rawMsg.includes('403')
      ) {
        userMsg =
          "YouTube bot verification triggered on this server IP. " +
          "Please upload the lecture video directly using 'Local Video File Mode', or set a valid YOUTUBE_COOKIE in server environment settings.";
      }

      throw new Error(`YouTube download failed: ${userMsg}`);
    }
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
      const client = await getYtdlClient();
      const info = await client.getInfo(url);
      const details = info.videoDetails;
      return {
        title: details.title || 'YouTube Lecture',
        duration: details.lengthSeconds || 0,
      };
    } catch (err: unknown) {
      // Fallback: if yt-dlp is available, retrieve video info
      if (isYtDlpAvailable()) {
        try {
          const result = await new Promise<{ title: string; duration: number }>((resolve, reject) => {
            const proc = spawn('yt-dlp', ['--print', '%(title)s', '--print', '%(duration)s', '--no-playlist', url]);
            let output = '';
            proc.stdout.on('data', (d) => (output += d.toString()));
            proc.on('close', (code) => {
              if (code === 0) {
                const lines = output.trim().split('\n');
                resolve({
                  title: lines[0] || 'YouTube Lecture',
                  duration: parseInt(lines[1] || '0', 10) || 0,
                });
              } else {
                reject(new Error('yt-dlp info failed'));
              }
            });
          });
          return result;
        } catch {
          // ignore fallback error
        }
      }

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
