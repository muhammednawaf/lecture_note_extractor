import mongoose, { Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { getIsMongoConnected } from '../database/connection.js';
import { config } from '../core/config.js';

export type ReconstructionStatus = 'VERIFIED' | 'NEEDS_REVIEW' | 'FAILED';

export interface IPage {
  id: string;
  jobId: string;
  pageNumber: number;
  imagePath: string;
  startTimestamp: number;
  endTimestamp: number;
  qualityScore: number;
  confidence: number;
  rotation: number; // 0, 90, 180, 270
  isEdited: boolean;
  createdAt: Date;

  // Milestone 1 Architectural Extensions
  sourceFrameIds: string[];
  reconstructionStatus: ReconstructionStatus;
  warnings: string[];
  pageIdentityId?: string;
}

const PageSchema = new Schema(
  {
    _id: { type: String, default: () => uuidv4() },
    jobId: { type: String, required: true, index: true },
    pageNumber: { type: Number, required: true, index: true },
    imagePath: { type: String, required: true },
    startTimestamp: { type: Number, required: true },
    endTimestamp: { type: Number, required: true },
    qualityScore: { type: Number, default: 1.0 },
    confidence: { type: Number, default: 1.0 },
    rotation: { type: Number, default: 0 },
    isEdited: { type: Boolean, default: false },
    sourceFrameIds: { type: [String], default: [] },
    reconstructionStatus: {
      type: String,
      enum: ['VERIFIED', 'NEEDS_REVIEW', 'FAILED'],
      default: 'VERIFIED',
    },
    warnings: { type: [String], default: [] },
    pageIdentityId: { type: String },
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

export const MongoosePageModel = mongoose.models.Page || mongoose.model('Page', PageSchema);

let memoryPages: IPage[] = [];

export const PageRepository = {
  async create(data: Omit<IPage, 'id' | 'createdAt' | 'rotation'> & { rotation?: number }): Promise<IPage> {
    const pageData: IPage = {
      ...data,
      id: uuidv4(),
      rotation: data.rotation || 0,
      sourceFrameIds: data.sourceFrameIds || [],
      reconstructionStatus: data.reconstructionStatus || 'VERIFIED',
      warnings: data.warnings || [],
      pageIdentityId: data.pageIdentityId,
      createdAt: new Date(),
    };

    if (getIsMongoConnected()) {
      try {
        const doc = await MongoosePageModel.create({
          _id: pageData.id,
          ...pageData,
        });
        return doc.toJSON() as IPage;
      } catch (e) {
        console.warn('Mongoose page create failed, falling back to memory store:', e);
      }
    }

    memoryPages.push(pageData);
    return pageData;
  },

  async findById(id: string): Promise<IPage | null> {
    if (getIsMongoConnected()) {
      try {
        const doc = await MongoosePageModel.findById(id);
        if (doc) return doc.toJSON() as IPage;
      } catch {
        // Fall back
      }
    }
    return memoryPages.find((p) => p.id === id) || null;
  },

  async findByJobId(jobId: string): Promise<IPage[]> {
    if (getIsMongoConnected()) {
      try {
        const docs = await MongoosePageModel.find({ jobId }).sort({ pageNumber: 1 });
        if (docs.length > 0) {
          return docs.map((d: any) => d.toJSON() as IPage);
        }
      } catch (e) {
        // Fall back
      }
    }

    const inMemory = memoryPages
      .filter((p) => p.jobId === jobId)
      .sort((a, b) => a.pageNumber - b.pageNumber);

    if (inMemory.length > 0) {
      return inMemory;
    }

    // Disk auto-discovery fallback if server restarted during development
    const jobPagesDir = path.join(config.pagesDir, jobId);
    if (fs.existsSync(jobPagesDir)) {
      const files = fs
        .readdirSync(jobPagesDir)
        .filter((f) => f.startsWith('page_') && f.endsWith('.jpg'))
        .sort();

      const discovered: IPage[] = files.map((file, idx) => {
        const pageNumber = idx + 1;
        return {
          id: uuidv4(),
          jobId,
          pageNumber,
          imagePath: `pages/${jobId}/${file}`,
          startTimestamp: 0,
          endTimestamp: 0,
          qualityScore: 0.88,
          confidence: 1.0,
          rotation: 0,
          isEdited: false,
          sourceFrameIds: [],
          reconstructionStatus: 'VERIFIED' as ReconstructionStatus,
          warnings: [],
          createdAt: new Date(),
        };
      });

      memoryPages.push(...discovered);
      return discovered;
    }

    return [];
  },

  async update(id: string, updates: Partial<IPage>): Promise<IPage | null> {
    if (getIsMongoConnected()) {
      try {
        const doc = await MongoosePageModel.findByIdAndUpdate(
          id,
          { $set: updates },
          { new: true }
        );
        if (doc) return doc.toJSON() as IPage;
      } catch {
        // Fall back
      }
    }

    const pageIndex = memoryPages.findIndex((p) => p.id === id);
    if (pageIndex === -1) return null;

    const updated = { ...memoryPages[pageIndex], ...updates };
    memoryPages[pageIndex] = updated;
    return updated;
  },

  async reorder(jobId: string, orderedPageIds: string[]): Promise<IPage[]> {
    const pages = await this.findByJobId(jobId);
    const pageMap = new Map(pages.map((p) => [p.id, p]));

    const reordered: IPage[] = [];
    for (let i = 0; i < orderedPageIds.length; i++) {
      const pageId = orderedPageIds[i];
      const page = pageMap.get(pageId);
      if (page) {
        page.pageNumber = i + 1;
        page.isEdited = true;
        await this.update(page.id, { pageNumber: i + 1, isEdited: true });
        reordered.push(page);
      }
    }

    return reordered;
  },

  async delete(id: string): Promise<boolean> {
    if (getIsMongoConnected()) {
      try {
        const res = await MongoosePageModel.findByIdAndDelete(id);
        if (res) return true;
      } catch (e) {
        // Fall back
      }
    }
    const initialLen = memoryPages.length;
    memoryPages = memoryPages.filter((p) => p.id !== id);
    return memoryPages.length < initialLen;
  },

  async deleteByJobId(
    jobId: string,
    options: { preserveEdited?: boolean } = { preserveEdited: true }
  ): Promise<number> {
    const preserveEdited = options.preserveEdited !== false;
    let deletedCount = 0;

    if (getIsMongoConnected()) {
      try {
        const filter: any = { jobId };
        if (preserveEdited) {
          filter.isEdited = { $ne: true };
        }
        const res = await MongoosePageModel.deleteMany(filter);
        deletedCount = res.deletedCount || 0;
      } catch (e) {
        console.warn('Mongoose deleteByJobId failed, falling back to memory store:', e);
      }
    }

    const initialLen = memoryPages.length;
    memoryPages = memoryPages.filter((p) => {
      if (p.jobId !== jobId) return true;
      if (preserveEdited && p.isEdited) return true;
      return false;
    });
    deletedCount = Math.max(deletedCount, initialLen - memoryPages.length);
    return deletedCount;
  },

  async getEditedPages(jobId: string): Promise<IPage[]> {
    if (getIsMongoConnected()) {
      try {
        const docs = await MongoosePageModel.find({ jobId, isEdited: true }).sort({ pageNumber: 1 });
        if (docs.length > 0) {
          return docs.map((d: any) => d.toJSON() as IPage);
        }
      } catch {
        // Fall back
      }
    }
    return memoryPages.filter((p) => p.jobId === jobId && p.isEdited);
  },

  /**
   * Delete pages belonging to the specified job IDs.
   */
  async deleteByJobIds(jobIds: string[]): Promise<number> {
    if (jobIds.length === 0) return 0;
    let count = 0;

    if (getIsMongoConnected()) {
      try {
        const res = await MongoosePageModel.deleteMany({ jobId: { $in: jobIds } });
        count += res.deletedCount || 0;
      } catch (e) {
        console.warn('[PageRepository] Mongo deleteByJobIds error:', e);
      }
    }

    const before = memoryPages.length;
    memoryPages = memoryPages.filter((p) => !jobIds.includes(p.jobId));
    count += before - memoryPages.length;
    return count;
  },

  clearMemoryStore(): void {
    memoryPages = [];
  },
};
