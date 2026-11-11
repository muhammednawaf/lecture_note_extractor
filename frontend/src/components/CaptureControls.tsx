import React from 'react';
import {
  Download,
  CheckCircle,
  AlertTriangle,
  Loader2,
  UploadCloud,
  FileVideo,
  Sparkles,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { JobStatus } from '../types';

interface CaptureControlsProps {
  sourceType: 'YOUTUBE' | 'UPLOAD';
  jobStatus: JobStatus | null;
  totalFrames: number;
  totalPages: number;
  uploadProgress: number; // 0-100, only for UPLOAD mode while uploading
  error: string | null;
  fps: number;
  hasJob: boolean;
  hasVideoOrUrl: boolean;
  onExtract: () => void;
  onFpsChange: (fps: number) => void;
  onViewNotes?: () => void;
}

function StatusBadge({ status }: { status: JobStatus | null }) {
  if (!status || status === 'CREATED') {
    return (
      <span className="inline-flex items-center gap-1.5 bg-zinc-800/80 text-zinc-400 px-2 py-0.5 rounded-full text-[11px] font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
        Ready
      </span>
    );
  }

  if (status === 'DOWNLOADING') {
    return (
      <span className="inline-flex items-center gap-1.5 bg-blue-950/60 text-blue-400 border border-blue-800/60 px-2.5 py-0.5 rounded-full text-[11px] font-medium">
        <Loader2 className="w-3 h-3 animate-spin" />
        Downloading Video
      </span>
    );
  }

  if (status === 'EXTRACTING') {
    return (
      <span className="inline-flex items-center gap-1.5 bg-amber-950/60 text-amber-400 border border-amber-800/60 px-2.5 py-0.5 rounded-full text-[11px] font-medium">
        <Loader2 className="w-3 h-3 animate-spin" />
        Extracting Video Frames
      </span>
    );
  }

  if (status === 'PROCESSING') {
    return (
      <span className="inline-flex items-center gap-1.5 bg-purple-950/60 text-purple-400 border border-purple-800/60 px-2.5 py-0.5 rounded-full text-[11px] font-medium">
        <Loader2 className="w-3 h-3 animate-spin" />
        Filtering & Creating Pages
      </span>
    );
  }

  if (status === 'COMPLETED' || status === 'CAPTURED') {
    return (
      <span className="inline-flex items-center gap-1.5 bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 px-2.5 py-0.5 rounded-full text-[11px] font-medium">
        <CheckCircle className="w-3 h-3" />
        Notes Ready
      </span>
    );
  }

  if (status === 'FAILED') {
    return (
      <span className="inline-flex items-center gap-1.5 bg-red-950/60 text-red-400 border border-red-800/60 px-2.5 py-0.5 rounded-full text-[11px] font-medium">
        <AlertTriangle className="w-3 h-3" />
        Extraction Failed
      </span>
    );
  }

  return null;
}

export const CaptureControls: React.FC<CaptureControlsProps> = ({
  sourceType,
  jobStatus,
  totalFrames,
  totalPages,
  uploadProgress,
  error,
  fps,
  hasJob,
  hasVideoOrUrl,
  onExtract,
  onFpsChange,
  onViewNotes,
}) => {
  const isUploadMode = sourceType === 'UPLOAD';
  const isActive =
    jobStatus === 'DOWNLOADING' || jobStatus === 'EXTRACTING' || jobStatus === 'PROCESSING';
  const isCompleted = jobStatus === 'COMPLETED';

  const canExtract = hasJob && hasVideoOrUrl && !isActive;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isUploadMode ? (
            <FileVideo className="w-4 h-4 text-emerald-400" />
          ) : (
            <Download className="w-4 h-4 text-emerald-400" />
          )}
          <h3 className="text-sm font-semibold text-zinc-100">
            {isUploadMode ? 'Direct File to PDF' : 'YouTube to PDF Notes'}
          </h3>
        </div>
        <StatusBadge status={jobStatus} />
      </div>

      {/* Description */}
      <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-3 text-xs text-zinc-400 space-y-1">
        <p className="leading-relaxed">
          {isUploadMode
            ? 'Your lecture video is analyzed end-to-end. Unnecessary duplicates, hand movements, and camera zoom snippets are automatically filtered out to give you clean, high-resolution notes.'
            : 'Enter a YouTube lecture link to automatically download, extract, filter duplicate notebook pages, and generate your ready-to-print PDF notes.'}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 bg-red-950/30 border border-red-900/40 rounded-lg p-2.5 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Live Progress Display when Active */}
      {isActive && (
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5 space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-300 font-medium">
            <span className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              {jobStatus === 'DOWNLOADING' && 'Downloading lecture from YouTube...'}
              {jobStatus === 'EXTRACTING' && 'Sampling and extracting lecture frames...'}
              {jobStatus === 'PROCESSING' && 'Deduplicating notebook pages & removing zoom crops...'}
            </span>
            {totalFrames > 0 && (
              <span className="font-mono text-zinc-400 text-[11px]">
                {totalFrames} frames
              </span>
            )}
          </div>

          {/* Upload progress bar (for local file upload) */}
          {isUploadMode && uploadProgress > 0 && uploadProgress < 100 && (
            <div>
              <div className="flex justify-between text-[11px] text-zinc-500 mb-1">
                <span>Uploading video...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5">
                <div
                  className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Subtle animated bar */}
          <div className="w-full bg-zinc-900 h-1 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full animate-pulse w-full" />
          </div>
        </div>
      )}

      {/* Success Banner when Completed */}
      {isCompleted && (
        <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-lg p-3.5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-emerald-300">
            <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>
              <strong>{totalPages > 0 ? totalPages : 1} clean pages</strong> extracted! Opening notes...
            </span>
          </div>
          {onViewNotes && (
            <button
              onClick={onViewNotes}
              className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 rounded-md transition-colors"
            >
              <span>View Notes</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Primary Conversion Button */}
      {!isCompleted && (
        <button
          type="button"
          onClick={onExtract}
          disabled={!canExtract || isActive}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2.5 px-4 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
        >
          {isActive ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>
                {jobStatus === 'DOWNLOADING' && 'Downloading Lecture...'}
                {jobStatus === 'EXTRACTING' && 'Extracting Frames...'}
                {jobStatus === 'PROCESSING' && 'Generating Clean Pages...'}
              </span>
            </>
          ) : (
            <>
              {isUploadMode ? (
                <UploadCloud className="w-3.5 h-3.5" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>Convert Lecture to PDF Notes</span>
            </>
          )}
        </button>
      )}

      {/* Re-convert button when already completed */}
      {isCompleted && (
        <button
          type="button"
          onClick={onExtract}
          className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-xs py-2 px-3.5 rounded-lg transition-colors border border-zinc-700"
        >
          <span>Re-Extract Video</span>
        </button>
      )}

      {/* Frame Rate Sampling Options */}
      <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-zinc-500 text-[11px]">
          <Clock className="w-3.5 h-3.5 text-zinc-400" />
          <span>Extraction Sampling:</span>
        </div>
        <div className="flex gap-1">
          {[0.5, 1.0, 2.0].map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => onFpsChange(rate)}
              disabled={isActive}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                fps === rate
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'bg-zinc-950 text-zinc-500 hover:text-zinc-300 border border-zinc-800/80'
              } disabled:opacity-50`}
            >
              {rate} fps
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
