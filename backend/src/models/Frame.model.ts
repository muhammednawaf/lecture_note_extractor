import mongoose, { Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { getIsMongoConnected } from '../database/connection.js';
import { config } from '../core/config.js';

export interface IFrame {
  id: string;
  jobId: string;
  frameIndex: number;
  timestamp: number;
  imagePath: string;
  width?: number;
  height?: number;
  fileSizeBytes?: number;
  createdAt: Date;
}

const FrameSchema = new Schema(
  {
    _id: { type: String, default: () => uuidv4() },
    jobId: { type: String, required: true, index: true },
    frameIndex: { type: Number, required: true, index: true },
    timestamp: { type: Number, required: true },
    imagePath: { type: String, required: true },
    width: { type: Number },
    height: { type: Number },
    fileSizeBytes: { type: Number },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
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

export const MongooseFrameModel = mongoose.models.Frame || mongoose.model('Frame', FrameSchema);

// Memory fallback store
let memoryFrames: IFrame[] = [];

export const FrameRepository = {
  async create(data: Omit<IFrame, 'id' | 'createdAt'>): Promise<IFrame> {
    const frameData: IFrame = {
      id: uuidv4(),
      ...data,
      createdAt: new Date(),
    };

    if (getIsMongoConnected()) {
      try {
        const doc = await MongooseFrameModel.create({
          _id: frameData.id,
          ...frameData,
        });
        return doc.toJSON() as IFrame;
      } catch (e) {
        console.warn('Mongoose frame create failed, falling back to memory store:', e);
      }
    }

    memoryFrames.push(frameData);
    return frameData;
  },

  async findByJobId(jobId: string, limit = 1000): Promise<IFrame[]> {
    if (getIsMongoConnected()) {
      try {
        const docs = await MongooseFrameModel.find({ jobId })
          .sort({ frameIndex: 1 })
          .limit(limit);
        if (docs.length > 0) {
          return docs.map((d: any) => d.toJSON() as IFrame);
        }
      } catch (e) {
        // Fall back
      }
    }

    const inMemory = memoryFrames
      .filter((f) => f.jobId === jobId)
      .sort((a, b) => a.frameIndex - b.frameIndex)
      .slice(0, limit);

    if (inMemory.length > 0) {
      return inMemory;
    }

    // Disk auto-discovery fallback if server restarted during development
    const jobFramesDir = path.join(config.framesDir, jobId);
    if (fs.existsSync(jobFramesDir)) {
      const files = fs
        .readdirSync(jobFramesDir)
        .filter((f) => f.startsWith('frame_') && f.endsWith('.jpg'))
        .sort();

      const discovered: IFrame[] = files.map((file, idx) => {
        // Filename format: frame_00000_14.50s.jpg
        const match = file.match(/frame_(\d+)_([0-9.]+)s\.jpg/);
        const frameIndex = match ? parseInt(match[1], 10) : idx;
        const timestamp = match ? parseFloat(match[2]) : idx * 1.0;
        const stats = fs.statSync(path.join(jobFramesDir, file));

        return {
          id: uuidv4(),
          jobId,
          frameIndex,
          timestamp,
          imagePath: `frames/${jobId}/${file}`,
          fileSizeBytes: stats.size,
          createdAt: stats.birthtime || new Date(),
        };
      });

      // Cache into memory
      memoryFrames.push(...discovered);
      return discovered.slice(0, limit);
    }

    return [];
  },

  async countByJobId(jobId: string): Promise<number> {
    const list = await this.findByJobId(jobId);
    return list.length;
  },

  /**
   * Delete frames belonging to the specified job IDs.
   */
  async deleteByJobIds(jobIds: string[]): Promise<number> {
    if (jobIds.length === 0) return 0;
    let count = 0;

    if (getIsMongoConnected()) {
      try {
        const res = await MongooseFrameModel.deleteMany({ jobId: { $in: jobIds } });
        count += res.deletedCount || 0;
      } catch (e) {
        console.warn('[FrameRepository] Mongo deleteByJobIds error:', e);
      }
    }

    const before = memoryFrames.length;
    memoryFrames = memoryFrames.filter((f) => !jobIds.includes(f.jobId));
    count += before - memoryFrames.length;
    return count;
  },

  clearMemoryStore(): void {
    memoryFrames = [];
  },
};
