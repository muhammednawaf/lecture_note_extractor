import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  RotateCw,
  Trash2,
  Download,
  AlertCircle,
  ShieldCheck,
  Filter,
} from 'lucide-react';
import { videoApi } from '../services/api';
import { ExtractedPage, Job, PdfExportOptions, PdfExportResponse } from '../types';
import { PageGrid } from '../components/PageGrid';
import { PageEditor } from '../components/PageEditor';
import { PdfExport } from '../components/PdfExport';

export const Review: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const jobId = searchParams.get('jobId');

  const [job, setJob] = useState<Job | null>(null);
  const [pages, setPages] = useState<ExtractedPage[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'needs_review'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!jobId) return;

    Promise.all([videoApi.getJob(jobId), videoApi.getPages(jobId)])
      .then(([j, p]) => {
        setJob(j);
        setPages(p);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [jobId]);

  const handleDeletePage = async (pageId: string) => {
    if (!confirm('Are you sure you want to remove this page from your lecture notes?')) {
      return;
    }
    try {
      await videoApi.deletePage(pageId);
      setPages((prev) => prev.filter((p) => p.id !== pageId));
    } catch (e) {
      console.error('Failed to delete page:', e);
    }
  };

  const handleRotatePage = async (pageId: string) => {
    try {
      const updated = await videoApi.rotatePage(pageId);
      setPages((prev) =>
        prev.map((p) =>
          p.id === pageId
            ? {
                ...p,
                rotation: updated.rotation,
                imageUrl: `${p.imageUrl.split('?')[0]}?v=${Date.now()}`,
              }
            : p
        )
      );
    } catch (e) {
      console.error('Failed to rotate page:', e);
    }
  };

  const handleToggleVerifyPage = async (pageId: string) => {
    const target = pages.find((p) => p.id === pageId);
    if (!target) return;

    const isCurrentlyNeedsReview =
      target.reconstructionStatus === 'NEEDS_REVIEW' ||
      target.confidence < 0.85 ||
      target.qualityScore < 0.7;

    const newStatus = isCurrentlyNeedsReview ? 'VERIFIED' : 'NEEDS_REVIEW';

    // Update state optimistically
    setPages((prev) =>
      prev.map((p) =>
        p.id === pageId
          ? {
              ...p,
              reconstructionStatus: newStatus,
              confidence: isCurrentlyNeedsReview ? Math.max(p.confidence, 0.9) : 0.65,
              isEdited: true,
            }
          : p
      )
    );

    try {
      await videoApi.updatePage(pageId, {
        reconstructionStatus: newStatus,
        isEdited: true,
      });
    } catch (e) {
      console.error('Failed to update page status:', e);
    }
  };

  const handleVerifyAll = async () => {
    const unverified = pages.filter(
      (p) =>
        p.reconstructionStatus === 'NEEDS_REVIEW' ||
        p.confidence < 0.85 ||
        p.qualityScore < 0.7
    );

    if (unverified.length === 0) return;

    setPages((prev) =>
      prev.map((p) => ({
        ...p,
        reconstructionStatus: 'VERIFIED',
        confidence: Math.max(p.confidence, 0.9),
        isEdited: true,
      }))
    );

    for (const p of unverified) {
      try {
        await videoApi.updatePage(p.id, {
          reconstructionStatus: 'VERIFIED',
          isEdited: true,
        });
      } catch (e) {
        console.error(`Failed to verify page ${p.id}:`, e);
      }
    }
  };

  const handleMovePage = async (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= pages.length || !jobId) return;

    const newPages = [...pages];
    const [moved] = newPages.splice(fromIndex, 1);
    newPages.splice(toIndex, 0, moved);

    // Update local state immediately for snappy UI
    const reindexed = newPages.map((p, idx) => ({ ...p, pageNumber: idx + 1 }));
    setPages(reindexed);

    // Sync to backend
    try {
      await videoApi.reorderPages(
        jobId,
        reindexed.map((p) => p.id)
      );
    } catch (e) {
      console.error('Failed to persist page order:', e);
    }
  };

  const handleExportPdf = async (options: PdfExportOptions): Promise<PdfExportResponse> => {
    if (!jobId) throw new Error('No active job ID found');
    return await videoApi.exportPdf(jobId, options);
  };

  const needsReviewCount = pages.filter(
    (p) =>
      p.reconstructionStatus === 'NEEDS_REVIEW' ||
      p.confidence < 0.85 ||
      p.qualityScore < 0.7
  ).length;

  const verifiedPagesCount = pages.filter(
    (p) =>
      p.reconstructionStatus === 'VERIFIED' ||
      (!p.reconstructionStatus && p.confidence >= 0.85 && p.qualityScore >= 0.7)
  ).length;

  const displayedPages =
    filterMode === 'needs_review'
      ? pages.filter(
          (p) =>
            p.reconstructionStatus === 'NEEDS_REVIEW' ||
            p.confidence < 0.85 ||
            p.qualityScore < 0.7
        )
      : pages;

  const selectedPage = selectedIndex !== null ? pages[selectedIndex] || null : null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg transition-colors border border-zinc-800"
            title="Return to Home"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-zinc-100">Review & Curate Lecture Notes</h1>
              <span className="text-xs font-mono bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
                Phase 6 & 7
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Verify extracted pages, adjust orientation or ordering, then compile your PDF.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-zinc-300 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg">
            {pages.length} Pages Extracted
          </span>
          {needsReviewCount > 0 && (
            <span className="font-mono text-amber-300 bg-amber-950/60 border border-amber-800/80 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{needsReviewCount} Need Review</span>
            </span>
          )}
        </div>
      </div>

      {/* Review Alert Banner */}
      {needsReviewCount > 0 && (
        <div className="bg-amber-950/30 border border-amber-800/60 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-amber-200">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>{needsReviewCount} {needsReviewCount === 1 ? 'page requires' : 'pages require'} review:</strong>{' '}
              Uncertain zoom alignments or scrolling sequences have been preserved for visual verification.
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() =>
                setFilterMode((prev) => (prev === 'needs_review' ? 'all' : 'needs_review'))
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filterMode === 'needs_review'
                  ? 'bg-amber-500 text-black'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-amber-300'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>{filterMode === 'needs_review' ? 'Show All' : 'Filter Needs Review'}</span>
            </button>

            <button
              onClick={handleVerifyAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Verify All</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Grid & Export Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (8 cols): Page Grid */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
            <span>
              {filterMode === 'needs_review'
                ? `Showing ${displayedPages.length} pages requiring review`
                : 'Click any page to inspect in full resolution. Use arrows to reorder.'}
            </span>
            <span className="text-zinc-500">Auto-saved to database</span>
          </div>

          <PageGrid
            pages={displayedPages}
            onDeletePage={handleDeletePage}
            onRotatePage={handleRotatePage}
            onMovePage={handleMovePage}
            onSelectPage={(page) => {
              const idx = pages.findIndex((p) => p.id === page.id);
              if (idx !== -1) setSelectedIndex(idx);
            }}
            onToggleVerify={handleToggleVerifyPage}
          />
        </div>

        {/* Right Column (4 cols): PDF Export Settings */}
        <div className="lg:col-span-4 sticky top-20">
          <PdfExport
            jobId={jobId || ''}
            defaultTitle={job?.videoTitle || 'Lecture Notes'}
            totalPages={pages.length}
            verifiedPagesCount={verifiedPagesCount}
            onExport={handleExportPdf}
          />
        </div>
      </div>

      {/* Full Screen Page Editor Modal */}
      <PageEditor
        page={selectedPage}
        totalPages={pages.length}
        onClose={() => setSelectedIndex(null)}
        onRotate={() => selectedPage && handleRotatePage(selectedPage.id)}
        onToggleVerify={() => selectedPage && handleToggleVerifyPage(selectedPage.id)}
        onPrev={
          selectedIndex !== null && selectedIndex > 0
            ? () => setSelectedIndex(selectedIndex - 1)
            : undefined
        }
        onNext={
          selectedIndex !== null && selectedIndex < pages.length - 1
            ? () => setSelectedIndex(selectedIndex + 1)
            : undefined
        }
      />
    </div>
  );
};
