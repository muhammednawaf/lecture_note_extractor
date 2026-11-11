import React from 'react';
import { ExtractedPage } from '../types';
import {
  Trash2,
  Clock,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Maximize2,
  Layers,
} from 'lucide-react';

interface PageCardProps {
  page: ExtractedPage;
  isFirst: boolean;
  isLast: boolean;
  onDelete: () => void;
  onRotate: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onClick: () => void;
  onToggleVerify?: () => void;
}

export const PageCard: React.FC<PageCardProps> = ({
  page,
  isFirst,
  isLast,
  onDelete,
  onRotate,
  onMoveLeft,
  onMoveRight,
  onClick,
  onToggleVerify,
}) => {
  const needsReview =
    page.reconstructionStatus === 'NEEDS_REVIEW' ||
    page.confidence < 0.85 ||
    page.qualityScore < 0.7;

  const mergedCount = page.sourceFrameIds?.length || 1;
  const hasWarnings = page.warnings && page.warnings.length > 0;

  return (
    <div
      className={`bg-zinc-900 border rounded-xl overflow-hidden group hover:border-zinc-700 transition-all shadow-sm flex flex-col ${
        needsReview ? 'border-amber-900/60' : 'border-zinc-800'
      }`}
    >
      {/* Thumbnail */}
      <div
        className="aspect-video bg-black relative cursor-pointer overflow-hidden flex items-center justify-center"
        onClick={onClick}
      >
        <img
          src={page.imageUrl}
          alt={`Page ${page.pageNumber}`}
          className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
          loading="lazy"
        />

        {/* Page number badge */}
        <span className="absolute top-2 left-2 bg-zinc-950/90 text-zinc-200 text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-800">
          Page {page.pageNumber}
        </span>

        {/* Multi-frame fusion badge */}
        {mergedCount > 1 && (
          <span
            className="absolute bottom-2 left-2 inline-flex items-center gap-1 bg-zinc-950/90 text-blue-300 border border-blue-900/70 text-[9px] font-mono px-1.5 py-0.5 rounded"
            title={`${mergedCount} source frames reconstructed into this page`}
          >
            <Layers className="w-2.5 h-2.5" />
            <span>{mergedCount} frames</span>
          </span>
        )}

        {/* Confidence / Review status badge */}
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {needsReview ? (
            <span
              className="inline-flex items-center gap-1 bg-amber-950/90 text-amber-300 border border-amber-800/80 text-[10px] px-2 py-0.5 rounded-full font-medium shadow-sm"
              title={page.warnings?.[0] || 'Requires visual confirmation'}
            >
              <AlertCircle className="w-2.5 h-2.5" />
              <span>Review</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 bg-emerald-950/90 text-emerald-400 border border-emerald-800/80 text-[10px] px-2 py-0.5 rounded-full font-medium shadow-sm">
              <CheckCircle2 className="w-2.5 h-2.5" />
              <span>Verified</span>
            </span>
          )}
        </div>

        {/* Hover zoom pill */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <span className="inline-flex items-center gap-1 bg-zinc-900/90 text-zinc-100 text-xs px-2.5 py-1 rounded-md border border-zinc-700 shadow-lg">
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Inspect</span>
          </span>
        </div>
      </div>

      {/* Metadata & Actions */}
      <div className="p-3 bg-zinc-950/80 border-t border-zinc-800/80 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-zinc-500" />
            <span>
              {page.startTimestamp.toFixed(1)}s – {page.endTimestamp.toFixed(1)}s
            </span>
          </span>
          <span className="font-mono text-zinc-500">
            Q: {(page.qualityScore * 100).toFixed(0)}%
          </span>
        </div>

        {/* Warning snippet if present */}
        {hasWarnings && (
          <div
            className="text-[10px] text-amber-400/90 bg-amber-950/30 border border-amber-900/40 rounded px-1.5 py-0.5 truncate flex items-center gap-1"
            title={page.warnings!.join(' | ')}
          >
            <AlertCircle className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{page.warnings![0]}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60">
          {/* Reorder Buttons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMoveLeft();
              }}
              disabled={isFirst}
              className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Move backward"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMoveRight();
              }}
              disabled={isLast}
              className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Move forward"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Edit / Rotate / Delete / Toggle Verify */}
          <div className="flex items-center gap-1">
            {onToggleVerify && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVerify();
                }}
                className={`p-1 rounded transition-colors ${
                  needsReview
                    ? 'bg-amber-950/60 hover:bg-amber-900 text-amber-300'
                    : 'bg-zinc-900 hover:bg-zinc-800 text-emerald-400'
                }`}
                title={needsReview ? 'Mark as Verified' : 'Mark as Needs Review'}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRotate();
              }}
              className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Rotate 90° clockwise"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1 rounded bg-zinc-900 hover:bg-red-950/80 text-zinc-400 hover:text-red-400 transition-colors"
              title="Delete page"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
