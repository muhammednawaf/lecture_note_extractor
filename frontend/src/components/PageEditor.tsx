import React from 'react';
import { ExtractedPage } from '../types';
import { getFullImageUrl } from '../services/api';
import {
  RotateCw,
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Layers,
  ShieldCheck,
} from 'lucide-react';

interface PageEditorProps {
  page: ExtractedPage | null;
  totalPages: number;
  onClose: () => void;
  onRotate?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onToggleVerify?: () => void;
}

export const PageEditor: React.FC<PageEditorProps> = ({
  page,
  totalPages,
  onClose,
  onRotate,
  onPrev,
  onNext,
  onToggleVerify,
}) => {
  if (!page) return null;

  const needsReview =
    page.reconstructionStatus === 'NEEDS_REVIEW' ||
    page.confidence < 0.85 ||
    page.qualityScore < 0.7;

  const mergedCount = page.sourceFrameIds?.length || 1;
  const hasWarnings = page.warnings && page.warnings.length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-5xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Modal Top Bar */}
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-zinc-100">
              Page {page.pageNumber} of {totalPages}
            </span>
            <span className="text-[11px] font-mono text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
              {page.startTimestamp.toFixed(1)}s – {page.endTimestamp.toFixed(1)}s
            </span>

            {/* Status indicator */}
            {needsReview ? (
              <span className="inline-flex items-center gap-1 bg-amber-950/80 text-amber-300 border border-amber-800/80 text-[11px] px-2 py-0.5 rounded font-medium">
                <AlertCircle className="w-3 h-3" />
                <span>Needs Review</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 text-[11px] px-2 py-0.5 rounded font-medium">
                <CheckCircle2 className="w-3 h-3" />
                <span>Verified</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onToggleVerify && (
              <button
                type="button"
                onClick={onToggleVerify}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  needsReview
                    ? 'bg-amber-600 hover:bg-amber-500 text-black'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                }`}
                title="Toggle verification status"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{needsReview ? 'Mark Verified' : 'Unverify'}</span>
              </button>
            )}

            {onRotate && (
              <button
                type="button"
                onClick={onRotate}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                title="Rotate 90 degrees"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Rotate</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-100 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Warning Banner if present */}
        {hasWarnings && (
          <div className="bg-amber-950/40 border-b border-amber-900/60 px-5 py-2 flex items-start gap-2.5 text-xs text-amber-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div className="space-y-0.5">
              <span className="font-semibold text-amber-200">Reconstruction Warnings:</span>
              <ul className="list-disc list-inside space-y-0.5 text-amber-300/90">
                {page.warnings!.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Image viewport */}
        <div className="flex-1 bg-black overflow-auto p-4 flex items-center justify-center relative min-h-[300px]">
          <img
            src={getFullImageUrl(page.imageUrl)}
            alt={`Page ${page.pageNumber}`}
            className="max-h-[68vh] max-w-full object-contain rounded shadow"
          />

          {/* Quick navigation arrows on sides */}
          {onPrev && (
            <button
              onClick={onPrev}
              className="absolute left-4 p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition-colors"
              title="Previous page"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}

          {onNext && (
            <button
              onClick={onNext}
              className="absolute right-4 p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition-colors"
              title="Next page"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
          <div className="flex flex-wrap items-center gap-4">
            <span>
              Quality: <strong className="text-zinc-200">{(page.qualityScore * 100).toFixed(0)}%</strong>
            </span>
            <span>
              Confidence: <strong className="text-zinc-200">{(page.confidence * 100).toFixed(0)}%</strong>
            </span>
            {mergedCount > 1 && (
              <span className="inline-flex items-center gap-1 font-mono text-blue-400">
                <Layers className="w-3.5 h-3.5" />
                <span>{mergedCount} source frames fused</span>
              </span>
            )}
            {page.pageIdentityId && (
              <span className="font-mono text-zinc-500 text-[10px]">
                ID: {page.pageIdentityId.slice(0, 8)}...
              </span>
            )}
          </div>

          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
