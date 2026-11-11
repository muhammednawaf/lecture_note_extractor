import axios from 'axios';
import {
  User,
  AuthResponse,
  Job,
  CapturedFrame,
  ExtractedPage,
  ApiHealth,
  ProcessJobResponse,
  PdfExportOptions,
  PdfExportResponse,
  ExtractionStartResponse,
  UploadVideoResponse,
} from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export const getFullImageUrl = (pathOrUrl?: string): string => {
  if (!pathOrUrl) return '';
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('data:')) {
    return pathOrUrl;
  }
  const cleanBase = BASE_URL.replace(/\/+$/, '');
  const cleanPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${cleanBase}${cleanPath}`;
};

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 120000, // 2 minutes (video downloads can be slow)
});

// Automatic Bearer Token Interceptor for Row-Level Access Control
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const videoApi = {
  // ─── Authentication (Row-Level Security & Access Control) ─────────────────
  register: async (email: string, password: string): Promise<AuthResponse> => {
    const res = await api.post<AuthResponse>('/api/auth/register', { email, password });
    if (res.data.token) {
      localStorage.setItem('token', res.data.token);
    }
    return res.data;
  },

  login: async (email: string, password: string): Promise<AuthResponse> => {
    const res = await api.post<AuthResponse>('/api/auth/login', { email, password });
    if (res.data.token) {
      localStorage.setItem('token', res.data.token);
    }
    return res.data;
  },

  getMe: async (): Promise<User> => {
    const res = await api.get<User>('/api/auth/me');
    return res.data;
  },

  logout: () => {
    localStorage.removeItem('token');
  },

  getToken: (): string | null => {
    return localStorage.getItem('token');
  },

  // ─── Health ───────────────────────────────────────────────────────────────
  checkHealth: async (): Promise<ApiHealth> => {
    const res = await api.get<ApiHealth>('/health');
    return res.data;
  },

  // ─── Jobs ─────────────────────────────────────────────────────────────────
  createJob: async (payload: {
    youtubeUrl?: string;
    videoTitle?: string;
    sourceType?: 'YOUTUBE' | 'UPLOAD';
  }): Promise<Job> => {
    const res = await api.post<Job>('/api/jobs', payload);
    return res.data;
  },

  getJob: async (jobId: string): Promise<Job> => {
    const res = await api.get<Job>(`/api/jobs/${jobId}`);
    return res.data;
  },

  updateJob: async (jobId: string, data: Partial<Job>): Promise<Job> => {
    const res = await api.patch<Job>(`/api/jobs/${jobId}`, data);
    return res.data;
  },

  listJobs: async (): Promise<Job[]> => {
    const res = await api.get<Job[]>('/api/jobs');
    return res.data;
  },

  // ─── YouTube Extraction ───────────────────────────────────────────────────
  /**
   * Start server-side YouTube video download + frame extraction.
   * This returns immediately — the backend runs extraction in the background.
   * Poll getJob() to track progress via job.status and job.totalFrames.
   */
  extractFromYouTube: async (jobId: string, fps = 1): Promise<ExtractionStartResponse> => {
    const res = await api.post<ExtractionStartResponse>(`/api/jobs/${jobId}/extract`, { fps });
    return res.data;
  },

  // ─── Local Video Upload ───────────────────────────────────────────────────
  /**
   * Upload a local video file to the backend for server-side frame extraction.
   * Returns immediately — backend extracts frames in the background.
   * Poll getJob() to track progress.
   */
  uploadVideoFile: async (
    jobId: string,
    file: File,
    fps = 1,
    onProgress?: (percent: number) => void
  ): Promise<UploadVideoResponse> => {
    const formData = new FormData();
    formData.append('video', file);
    formData.append('fps', fps.toString());

    const res = await api.post<UploadVideoResponse>(`/api/jobs/${jobId}/upload-video`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000, // 5 minutes for large file uploads
      onUploadProgress: (evt) => {
        if (onProgress && evt.total) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          onProgress(pct);
        }
      },
    });
    return res.data;
  },

  // ─── Processing Pipeline (Phases 2–5) ────────────────────────────────────
  processJob: async (jobId: string): Promise<ProcessJobResponse> => {
    const res = await api.post<ProcessJobResponse>(`/api/jobs/${jobId}/process`, undefined, {
      timeout: 300000, // Processing can take a few minutes
    });
    return res.data;
  },

  // ─── Frames (kept for reference, not used in main flow anymore) ───────────
  uploadFrame: async (
    jobId: string,
    file: Blob,
    timestamp: number,
    frameIndex: number
  ): Promise<CapturedFrame> => {
    const formData = new FormData();
    formData.append('file', file, `frame_${frameIndex}.jpg`);
    formData.append('timestamp', timestamp.toString());
    formData.append('frameIndex', frameIndex.toString());

    const res = await api.post<CapturedFrame>(`/api/jobs/${jobId}/frames`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return {
      ...res.data,
      imageUrl: getFullImageUrl(res.data.imageUrl),
    };
  },

  getFrames: async (jobId: string, limit = 100): Promise<CapturedFrame[]> => {
    const res = await api.get<CapturedFrame[]>(`/api/jobs/${jobId}/frames`, {
      params: { limit },
    });
    return (res.data || []).map((f) => ({
      ...f,
      imageUrl: getFullImageUrl(f.imageUrl),
    }));
  },

  // ─── Pages (Phase 6) ──────────────────────────────────────────────────────
  getPages: async (jobId: string): Promise<ExtractedPage[]> => {
    const res = await api.get<ExtractedPage[]>(`/api/jobs/${jobId}/pages`);
    return (res.data || []).map((p) => ({
      ...p,
      imageUrl: getFullImageUrl(p.imageUrl),
    }));
  },

  rotatePage: async (pageId: string): Promise<ExtractedPage> => {
    const res = await api.post<ExtractedPage>(`/api/pages/${pageId}/rotate`);
    return {
      ...res.data,
      imageUrl: getFullImageUrl(res.data.imageUrl),
    };
  },

  reorderPages: async (jobId: string, orderedPageIds: string[]): Promise<ExtractedPage[]> => {
    const res = await api.post<ExtractedPage[]>(`/api/jobs/${jobId}/pages/reorder`, {
      orderedPageIds,
    });
    return res.data;
  },

  deletePage: async (pageId: string): Promise<{ status: string }> => {
    const res = await api.delete<{ status: string }>(`/api/pages/${pageId}`);
    return res.data;
  },

  updatePage: async (pageId: string, updates: Partial<ExtractedPage>): Promise<ExtractedPage> => {
    const res = await api.patch<ExtractedPage>(`/api/pages/${pageId}`, updates);
    return res.data;
  },

  // ─── PDF Export (Phase 7) ─────────────────────────────────────────────────
  exportPdf: async (jobId: string, options: PdfExportOptions = {}): Promise<PdfExportResponse> => {
    const res = await api.post<PdfExportResponse>(`/api/jobs/${jobId}/export`, options, {
      timeout: 300000,
    });
    return res.data;
  },

  getPdfDownloadUrl: (jobId: string): string => {
    return `${BASE_URL}/api/jobs/${jobId}/download`;
  },

  downloadPdfBlob: async (jobId: string, filename?: string): Promise<void> => {
    const res = await api.get(`/api/jobs/${jobId}/download`, {
      responseType: 'blob',
    });

    const contentType = String(res.headers['content-type'] || '');
    if (contentType.includes('application/json')) {
      const text = await (res.data as Blob).text();
      try {
        const json = JSON.parse(text);
        throw new Error(json.error || 'Failed to download PDF');
      } catch (e: any) {
        throw new Error(e.message || 'Failed to download PDF');
      }
    }

    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeFilename = filename && filename.trim() ? filename : 'lecture_notes.pdf';
    link.setAttribute('download', safeFilename.endsWith('.pdf') ? safeFilename : `${safeFilename}.pdf`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },
};
