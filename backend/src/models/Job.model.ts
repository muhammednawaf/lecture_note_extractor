import mongoose, { Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { getIsMongoConnected } from '../database/connection.js';
import { config } from '../core/config.js';

export type JobStatus =
  | 'CREATED'
  | 'CAPTURING'
  | 'DOWNLOADING'
  | 'EXTRACTING'
  | 'CAPTURED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

export interface IJob {
  id: string;
  userId?: string; // Row-level security: tenant/owner identity
  youtubeUrl: string;
  videoTitle: string;
  sourceType: 'YOUTUBE' | 'UPLOAD';
  videoFilePath?: string;
  status: JobStatus;
  totalFrames: number;
  totalPages: number;
  createdAt: Date;
  updatedAt: Date;
}

const JobSchema = new Schema(
  {
    _id: { type: String, default: () => uuidv4() },
    userId: { type: String, required: false, index: true },
    youtubeUrl: { type: String, default: '' },
    videoTitle: { type: String, default: 'Untitled Lecture' },
    sourceType: { type: String, enum: ['YOUTUBE', 'UPLOAD'], default: 'YOUTUBE' },
    videoFilePath: { type: String, required: false },
    status: {
      type: String,
      enum: ['CREATED', 'CAPTURING', 'DOWNLOADING', 'EXTRACTING', 'CAPTURED', 'PROCESSING', 'COMPLETED', 'FAILED'],
      default: 'CREATED',
    },
    totalFrames: { type: Number, default: 0 },
    totalPages: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_, ret: any) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const MongooseJobModel = mongoose.models.Job || mongoose.model('Job', JobSchema);

// Memory fallback store for quick local development without MongoDB
const memoryJobs = new Map<string, IJob>();

export const JobRepository = {
  async create(data: {
    id?: string;
    userId?: string;
    youtubeUrl?: string;
    videoTitle?: string;
    sourceType?: 'YOUTUBE' | 'UPLOAD';
    videoFilePath?: string;
    status?: JobStatus;
    totalFrames?: number;
    totalPages?: number;
    createdAt?: Date;
  }): Promise<IJob> {
    const jobData: IJob = {
      id: data.id || uuidv4(),
      userId: data.userId,
      youtubeUrl: data.youtubeUrl || '',
      videoTitle: data.videoTitle || 'Lecture Video',
      sourceType: data.sourceType || (data.youtubeUrl ? 'YOUTUBE' : 'UPLOAD'),
      videoFilePath: data.videoFilePath,
      status: data.status || 'CREATED',
      totalFrames: data.totalFrames || 0,
      totalPages: data.totalPages || 0,
      createdAt: data.createdAt || new Date(),
      updatedAt: new Date(),
    };

    if (getIsMongoConnected()) {
      try {
        const doc = await MongooseJobModel.create({
          _id: jobData.id,
          ...jobData,
        });
        return doc.toJSON() as IJob;
      } catch (e) {
        console.warn('Mongoose create failed, falling back to memory store:', e);
      }
    }

    memoryJobs.set(jobData.id, jobData);
    return jobData;
  },

  async findById(id: string, userId?: string): Promise<IJob | null> {
    if (getIsMongoConnected()) {
      try {
        const filter: any = { _id: id };
        if (userId) filter.userId = userId;

        const doc = await MongooseJobModel.findOne(filter);
        if (doc) return doc.toJSON() as IJob;
      } catch (e) {
        // Fall back
      }
    }

    const inMemory = memoryJobs.get(id);
    if (inMemory) {
      if (userId && inMemory.userId && inMemory.userId !== userId) {
        return null; // Row-Level Security violation
      }
      return inMemory;
    }

    // Disk auto-discovery if server was restarted during development
    const jobFramesDir = path.join(config.framesDir, id);
    if (fs.existsSync(jobFramesDir)) {
      const files = fs.readdirSync(jobFramesDir).filter((f) => f.endsWith('.jpg'));
      const fallbackJob: IJob = {
        id,
        userId,
        youtubeUrl: '',
        videoTitle: 'Lecture Extraction',
        sourceType: 'YOUTUBE',
        status: 'CAPTURED',
        totalFrames: files.length,
        totalPages: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memoryJobs.set(id, fallbackJob);
      return fallbackJob;
    }

    return null;
  },

  async update(id: string, updates: Partial<IJob>, userId?: string): Promise<IJob | null> {
    const existing = await this.findById(id, userId);
    if (!existing) return null;

    if (getIsMongoConnected()) {
      try {
        const filter: any = { _id: id };
        if (userId) filter.userId = userId;

        const doc = await MongooseJobModel.findOneAndUpdate(
          filter,
          { $set: updates },
          { new: true }
        );
        if (doc) return doc.toJSON() as IJob;
      } catch (e) {
        // Fall back
      }
    }

    const updated = { ...existing, ...updates, updatedAt: new Date() };
    memoryJobs.set(id, updated);
    return updated;
  },

  async list(options: { userId?: string; limit?: number } = {}): Promise<IJob[]> {
    const limit = options.limit || 20;

    if (getIsMongoConnected()) {
      try {
        const filter: any = {};
        if (options.userId) filter.userId = options.userId;

        const docs = await MongooseJobModel.find(filter).sort({ createdAt: -1 }).limit(limit);
        return docs.map((d: any) => d.toJSON() as IJob);
      } catch (e) {
        // Fall back
      }
    }

    let all = Array.from(memoryJobs.values());
    if (options.userId) {
      all = all.filter((j) => !j.userId || j.userId === options.userId);
    }

    return all
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  },

  async delete(id: string, userId?: string): Promise<boolean> {
    const existing = await this.findById(id, userId);
    if (!existing) return false;

    if (getIsMongoConnected()) {
      try {
        const filter: any = { _id: id };
        if (userId) filter.userId = userId;
        await MongooseJobModel.deleteOne(filter);
      } catch {
        // Fall back
      }
    }

    memoryJobs.delete(id);
    return true;
  },

  /**
   * Deletes all jobs created before the given cutoff date.
   * Returns an array of deleted job IDs so associated assets can be purged.
   */
  async deleteExpired(cutoffDate: Date): Promise<string[]> {
    const deletedJobIds: string[] = [];

    if (getIsMongoConnected()) {
      try {
        const expiredDocs = await MongooseJobModel.find(
          { createdAt: { $lt: cutoffDate } },
          { _id: 1 }
        );
        for (const doc of expiredDocs) {
          deletedJobIds.push(doc._id.toString());
        }
        await MongooseJobModel.deleteMany({ createdAt: { $lt: cutoffDate } });
      } catch (e) {
        console.warn('[JobRepository] Mongo deleteExpired error:', e);
      }
    }

    for (const [id, job] of memoryJobs.entries()) {
      if (job.createdAt < cutoffDate) {
        if (!deletedJobIds.includes(id)) {
          deletedJobIds.push(id);
        }
        memoryJobs.delete(id);
      }
    }

    return deletedJobIds;
  },

  clearMemoryStore(): void {
    memoryJobs.clear();
  },
};
