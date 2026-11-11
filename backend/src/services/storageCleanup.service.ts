/**
 * Storage Cleanup Service
 * Automatically purges stored frames, pages, PDFs, and uploaded/downloaded videos
 * older than 1 hour (configurable via STORAGE_RETENTION_MS).
 * Also cleans up expired database records and memory stores to prevent disk and RAM leaks in production.
 */

import fs from 'fs';
import path from 'path';
import { config } from '../core/config.js';
import { JobRepository } from '../models/Job.model.js';
import { FrameRepository } from '../models/Frame.model.js';
import { PageRepository } from '../models/Page.model.js';

export interface CleanupResult {
  expiredJobs: number;
  filesDeleted: number;
  dirsDeleted: number;
  durationMs: number;
}

export class StorageCleanupService {
  private static timer: NodeJS.Timeout | null = null;

  /**
   * Runs a complete storage & database cleanup sweep.
   * Purges all assets and job records older than retentionMs (default: 1 hour).
   */
  static async runCleanup(customRetentionMs?: number): Promise<CleanupResult> {
    const startTime = Date.now();
    const retentionMs = customRetentionMs ?? config.retentionMs;
    const cutoffTime = startTime - retentionMs;
    const cutoffDate = new Date(cutoffTime);

    let filesDeleted = 0;
    let dirsDeleted = 0;

    try {
      // 1. Purge expired jobs from DB / memory
      const expiredJobIds = await JobRepository.deleteExpired(cutoffDate);
      if (expiredJobIds.length > 0) {
        await FrameRepository.deleteByJobIds(expiredJobIds);
        await PageRepository.deleteByJobIds(expiredJobIds);
      }

      // 2. Remove storage directories belonging to expired jobs
      for (const jobId of expiredJobIds) {
        const dirsToPurge = [
          path.join(config.framesDir, jobId),
          path.join(config.pagesDir, jobId),
          path.join(config.videosDir, jobId),
          path.join(config.pdfsDir, jobId),
        ];

        for (const dir of dirsToPurge) {
          if (fs.existsSync(dir)) {
            try {
              fs.rmSync(dir, { recursive: true, force: true });
              dirsDeleted++;
            } catch (err: any) {
              console.warn(`[StorageCleanup] Could not remove directory ${dir}: ${err.message}`);
            }
          }
        }
      }

      // 3. Scan storage roots for orphaned files/folders older than retention threshold
      const storageRoots = [
        config.framesDir,
        config.pagesDir,
        config.pdfsDir,
        config.videosDir,
        config.tempDir,
      ];

      for (const root of storageRoots) {
        if (!fs.existsSync(root)) continue;

        try {
          const entries = fs.readdirSync(root);
          for (const entry of entries) {
            const entryPath = path.join(root, entry);
            try {
              const stat = fs.statSync(entryPath);
              if (stat.mtimeMs < cutoffTime) {
                if (stat.isDirectory()) {
                  fs.rmSync(entryPath, { recursive: true, force: true });
                  dirsDeleted++;
                } else {
                  fs.unlinkSync(entryPath);
                  filesDeleted++;
                }
              }
            } catch (statErr: any) {
              // File might have been concurrently deleted or locked
            }
          }
        } catch (dirErr: any) {
          console.warn(`[StorageCleanup] Error scanning root ${root}: ${dirErr.message}`);
        }
      }

      const durationMs = Date.now() - startTime;
      if (expiredJobIds.length > 0 || filesDeleted > 0 || dirsDeleted > 0) {
        console.log(
          `[StorageCleanup] Sweep complete (${durationMs}ms): ${expiredJobIds.length} expired jobs, ` +
            `${dirsDeleted} directories, and ${filesDeleted} files purged (> ${Math.round(
              retentionMs / 60000
            )}m old).`
        );
      }

      return {
        expiredJobs: expiredJobIds.length,
        filesDeleted,
        dirsDeleted,
        durationMs,
      };
    } catch (err: any) {
      console.error('[StorageCleanup] Critical error during cleanup sweep:', err);
      return {
        expiredJobs: 0,
        filesDeleted,
        dirsDeleted,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Starts periodic automated cleanup.
   * Runs an initial cleanup, then triggers at configured interval (default: every 10 min).
   */
  static startScheduledCleanup(intervalMs?: number): void {
    if (this.timer) {
      clearInterval(this.timer);
    }

    const interval = intervalMs ?? config.cleanupIntervalMs;

    // Run initial cleanup sweep shortly after boot
    setTimeout(() => {
      this.runCleanup().catch((e) => console.error('[StorageCleanup] Initial sweep failed:', e));
    }, 2000).unref();

    this.timer = setInterval(() => {
      this.runCleanup().catch((e) => console.error('[StorageCleanup] Scheduled sweep failed:', e));
    }, interval);

    // Unref timer so it does not block Node.js from exiting in tests or scripts
    this.timer.unref();

    console.log(
      `[StorageCleanup] Background cleanup daemon active (interval: ${Math.round(
        interval / 60000
      )}m, retention: ${Math.round(config.retentionMs / 60000)}m).`
    );
  }

  /**
   * Stop scheduled cleanup (e.g. during graceful shutdown or testing).
   */
  static stopScheduledCleanup(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

