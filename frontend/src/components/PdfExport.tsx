import React, { useState } from 'react';
import { FileText, Download, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { PdfExportOptions, PdfExportResponse } from '../types';

interface PdfExportProps {
  jobId: string;
  defaultTitle?: string;
  totalPages: number;
  verifiedPagesCount?: number;
  onExport: (options: PdfExportOptions) => Promise<PdfExportResponse>;
}

export const PdfExport: React.FC<PdfExportProps> = ({
  jobId,
  defaultTitle,
  totalPages,
  verifiedPagesCount,
  onExport,
}) => {
  const [title, setTitle] = useState(defaultTitle || 'Lecture Notes');
  const [pageSize, setPageSize] = useState<'A4' | 'LETTER' | 'ORIGINAL'>('A4');
  const [orientation, setOrientation] = useState<'auto' | 'landscape' | 'portrait'>('auto');
  const [includePageNumbers, setIncludePageNumbers] = useState(true);
  const [onlyVerified, setOnlyVerified] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportedPdf, setExportedPdf] = useState<PdfExportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveVerifiedCount = verifiedPagesCount !== undefined ? verifiedPagesCount : totalPages;

  const handleGeneratePdf = async () => {
    setError(null);
    setIsExporting(true);

    try {
      const res = await onExport({
        title: title.trim() || 'Lecture Notes',
        pageSize,
        pageOrientation: orientation,
        includePageNumbers,
        margin: pageSize === 'ORIGINAL' ? 0 : 18,
        onlyVerified,
      });
      setExportedPdf(res);

      // Trigger automatic browser download
      const link = document.createElement('a');
      link.href = res.downloadUrl;
      link.setAttribute('download', res.filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      setError(err.message || 'Failed to generate PDF document');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-zinc-100">PDF Export Settings</h3>
        </div>
        <span className="text-xs font-mono text-zinc-400">
          {onlyVerified ? `${effectiveVerifiedCount} verified` : `${totalPages} pages`}
        </span>
      </div>

      {/* Form Controls */}
      <div className="space-y-3 text-xs">
        {/* Document Title */}
        <div>
          <label className="text-zinc-400 block mb-1">Document Title:</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Lecture Notes"
            className="w-full bg-zinc-950 border border-zinc-700/80 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
        </div>

        {/* Paper Size & Orientation */}
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="text-zinc-400 block mb-1">Page Format:</label>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value as any)}
              className="w-full bg-zinc-950 border border-zinc-700/80 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
            >
              <option value="A4">A4 Standard</option>
              <option value="LETTER">US Letter</option>
              <option value="ORIGINAL">Fit to Slide (No margins)</option>
            </select>
          </div>

          <div>
            <label className="text-zinc-400 block mb-1">Orientation:</label>
            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as any)}
              className="w-full bg-zinc-950 border border-zinc-700/80 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
            >
              <option value="auto">Auto (Per slide)</option>
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </div>
        </div>

        {/* Verified pages only filter checkbox */}
        <div className="flex items-start gap-2 pt-2 border-t border-zinc-800/80">
          <input
            type="checkbox"
            id="onlyVerified"
            checked={onlyVerified}
            onChange={(e) => setOnlyVerified(e.target.checked)}
            className="mt-0.5 rounded bg-zinc-950 border-zinc-700 text-emerald-600 focus:ring-0 focus:ring-offset-0"
          />
          <div className="space-y-0.5">
            <label
              htmlFor="onlyVerified"
              className="text-zinc-200 cursor-pointer font-medium flex items-center gap-1.5"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export only verified pages</span>
              <span className="text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 px-1.5 py-0.2 rounded font-mono">
                Verified Only
              </span>
            </label>
            <p className="text-[11px] text-zinc-400">
              {onlyVerified
                ? `${effectiveVerifiedCount} verified ${
                    effectiveVerifiedCount === 1 ? 'page' : 'pages'
                  } will be compiled. Unverified/uncertain captures are excluded.`
                : `All ${totalPages} extracted pages will be included in the PDF.`}
            </p>
          </div>
        </div>

        {/* Page numbering checkbox */}
        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="pageNumbers"
            checked={includePageNumbers}
            onChange={(e) => setIncludePageNumbers(e.target.checked)}
            className="rounded bg-zinc-950 border-zinc-700 text-emerald-600 focus:ring-0 focus:ring-offset-0"
          />
          <label htmlFor="pageNumbers" className="text-zinc-300 cursor-pointer text-xs">
            Print page numbers in footer (Page X of Y)
          </label>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-950/30 p-2.5 rounded border border-red-900/40">
          {error}
        </p>
      )}

      {/* Generate Action */}
      <button
        type="button"
        onClick={handleGeneratePdf}
        disabled={isExporting || totalPages === 0 || (onlyVerified && effectiveVerifiedCount === 0)}
        className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs py-2.5 px-4 rounded-lg transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isExporting ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Compiling PDF Document...</span>
          </>
        ) : (
          <>
            <Download className="w-3.5 h-3.5" />
            <span>Compile & Download PDF ({onlyVerified ? effectiveVerifiedCount : totalPages} pages)</span>
          </>
        )}
      </button>

      {/* Export Confirmation */}
      {exportedPdf && (
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <CheckCircle2 className="w-4 h-4" />
            <span>PDF Exported Successfully</span>
          </div>
          <div className="text-[11px] text-zinc-400 flex items-center justify-between">
            <span className="truncate max-w-[180px]">{exportedPdf.filename}</span>
            <span>{(exportedPdf.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB ({exportedPdf.pageCount} pages)</span>
          </div>
          <a
            href={exportedPdf.downloadUrl}
            download={exportedPdf.filename}
            className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"
          >
            <span>Click to download again</span>
          </a>
        </div>
      )}
    </div>
  );
};
