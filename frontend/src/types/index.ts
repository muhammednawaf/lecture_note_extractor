export type JobStatus =
  | 'CREATED'
  | 'CAPTURING'
  | 'DOWNLOADING'
  | 'EXTRACTING'
  | 'CAPTURED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

export interface User {
  id: string;
  email: string;
  createdAt?: string;
}

export interface AuthResponse {
  status: string;
  token: string;
  user: User;
}

export interface Job {
  id: string;
  youtubeUrl: string;
  videoTitle: string;
  sourceType: 'YOUTUBE' | 'UPLOAD';
  videoFilePath?: string;
  status: JobStatus;
  totalFrames: number;
  totalPages: number;
  createdAt: string;
  updatedAt: string;
}

export interface CapturedFrame {
  id: string;
  jobId: string;
  frameIndex: number;
  timestamp: number;
  imagePath: string;
  imageUrl: string;
  width?: number;
  height?: number;
  fileSizeBytes?: number;
  createdAt: string;
}

export type ReconstructionStatus = 'VERIFIED' | 'NEEDS_REVIEW' | 'FAILED';

export interface ExtractedPage {
  id: string;
  jobId: string;
  pageNumber: number;
  imagePath: string;
  imageUrl: string;
  startTimestamp: number;
  endTimestamp: number;
  qualityScore: number;
  confidence: number;
  rotation?: number;
  isEdited: boolean;
  createdAt: string;
  sourceFrameIds?: string[];
  reconstructionStatus?: ReconstructionStatus;
  warnings?: string[];
  pageIdentityId?: string;
}

export interface CaptureConfig {
  fps: number;
  quality: number;
  autoDetectTransitions: boolean;
}

export interface ApiHealth {
  status: string;
  service: string;
  database: string;
  timestamp: string;
}

export interface ProcessJobResponse {
  status: string;
  jobId: string;
  totalFramesInput: number;
  duplicatesRemoved: number;
  scrollSequencesDetected: number;
  finalPagesExtracted: number;
  pages: ExtractedPage[];
}

export interface PdfExportOptions {
  title?: string;
  pageSize?: 'A4' | 'LETTER' | 'ORIGINAL';
  includePageNumbers?: boolean;
  pageOrientation?: 'auto' | 'portrait' | 'landscape';
  margin?: number;
  onlyVerified?: boolean;
}

export interface PdfExportResponse {
  status: string;
  jobId: string;
  filename: string;
  filePath: string;
  downloadUrl: string;
  pageCount: number;
  fileSizeBytes: number;
  verifiedOnly?: boolean;
}

export interface ExtractionStartResponse {
  status: string;
  jobId: string;
  message: string;
}

export interface UploadVideoResponse {
  status: string;
  jobId: string;
  message: string;
}
