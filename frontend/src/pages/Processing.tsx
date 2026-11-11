import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Sparkles,
  Layers,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Scissors,
  Eye,
  FileCheck,
} from 'lucide-react';
import { videoApi, getFullImageUrl } from '../services/api';
import { Job, CapturedFrame, ProcessJobResponse } from '../types';

export const Processing: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const jobId = searchParams.get('jobId');

  const [job, setJob] = useState<Job | null>(null);
  const [frames, setFrames] = useState<CapturedFrame[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processResults, setProcessResults] = useState<ProcessJobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    videoApi
      .getJob(jobId)
      .then(setJob)
      .catch(console.error);

    videoApi
      .getFrames(jobId, 500)
      .then(setFrames)
      .catch(console.error);
  }, [jobId]);

  const handleRunPipeline = async () => {
    if (!jobId) return;
    setError(null);
    setIsProcessing(true);

    try {
      const results = await videoApi.processJob(jobId);
      setProcessResults(results);

      // Refresh job state
      const updatedJob = await videoApi.getJob(jobId);
      setJob(updatedJob);
    } catch (err: any) {
      console.error('Pipeline processing error:', err);
      setError(
        err.response?.data?.error || err.message || 'Error occurred while processing lecture frames.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const dupPercent = processResults && processResults.totalFramesInput > 0
    ? Math.round((processResults.duplicatesRemoved / processResults.totalFramesInput) * 100)
    : 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg transition-colors border border-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span>Intelligent Page Detection Pipeline</span>
              <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full border border-slate-700">
                Phases 2 – 5
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Job: <span className="font-mono text-emerald-400">{jobId}</span> &bull; {job?.videoTitle || 'Lecture'}
            </p>
          </div>
        </div>

        {processResults && (
          <button
            onClick={() => navigate(`/review?jobId=${jobId}`)}
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors shadow-md"
          >
            <span>Review Pages ({processResults.finalPagesExtracted})</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-rose-950/40 border border-rose-900/60 p-3.5 rounded-xl text-xs text-rose-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Pipeline Stages Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">Automated CV Pipeline Stages</h2>
          </div>

          <button
            type="button"
            onClick={handleRunPipeline}
            disabled={isProcessing || frames.length === 0}
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-4 py-2 rounded-lg transition-colors shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Running Algorithms...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>Run Extraction Pipeline</span>
              </>
            )}
          </button>
        </div>

        {/* 4 Pipeline Stage Badges */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-1">
          <div className={`p-3 rounded-lg border text-xs space-y-1 ${
            processResults ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">1. Duplicate Removal</span>
              {processResults && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
            </div>
            <p className="text-[11px] text-slate-500">SSIM & dHash perceptual hash filter</p>
          </div>

          <div className={`p-3 rounded-lg border text-xs space-y-1 ${
            processResults ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">2. Transition Detector</span>
              {processResults && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
            </div>
            <p className="text-[11px] text-slate-500">Slide transitions vs. scrolling regions</p>
          </div>

          <div className={`p-3 rounded-lg border text-xs space-y-1 ${
            processResults ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">3. Document Stitcher</span>
              {processResults && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
            </div>
            <p className="text-[11px] text-slate-500">Overlap removal & vertical slice composite</p>
          </div>

          <div className={`p-3 rounded-lg border text-xs space-y-1 ${
            processResults ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">4. Quality & Bounds</span>
              {processResults && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
            </div>
            <p className="text-[11px] text-slate-500">Laplacian sharpness & conservative crop</p>
          </div>
        </div>
      </div>

      {/* Analytics Metrics Grid */}
      {processResults && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
            <span className="text-xs text-slate-400">Frames Ingested</span>
            <p className="text-2xl font-bold font-mono text-slate-100 mt-1">
              {processResults.totalFramesInput}
            </p>
            <span className="text-[11px] text-slate-500">Raw capture stream</span>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
            <span className="text-xs text-slate-400">Duplicates Filtered</span>
            <p className="text-2xl font-bold font-mono text-emerald-400 mt-1">
              {processResults.duplicatesRemoved}
            </p>
            <span className="text-[11px] text-emerald-500/80">
              {dupPercent}% reduction in noise
            </span>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
            <span className="text-xs text-slate-400">Scroll Sequences</span>
            <p className="text-2xl font-bold font-mono text-sky-400 mt-1">
              {processResults.scrollSequencesDetected}
            </p>
            <span className="text-[11px] text-slate-500">Stitched tall pages</span>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
            <span className="text-xs text-slate-400">Unique Pages</span>
            <p className="text-2xl font-bold font-mono text-amber-400 mt-1">
              {processResults.finalPagesExtracted}
            </p>
            <span className="text-[11px] text-slate-500">Ready for notes PDF</span>
          </div>
        </div>
      )}

      {/* Frame Gallery */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-200">
              Captured Stream Preview ({frames.length} frames)
            </h3>
          </div>
          {frames.length === 0 && (
            <span className="text-xs text-rose-400">No frames available. Go to Capture screen first.</span>
          )}
        </div>

        {frames.length === 0 ? (
          <div className="bg-slate-950 border border-dashed border-slate-800 rounded-lg p-8 text-center text-slate-500">
            <p className="text-xs">No captured frames found for this job.</p>
            <button
              onClick={() => navigate('/')}
              className="mt-2 text-xs text-emerald-400 hover:underline"
            >
              Return to Capture Screen
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 max-h-[460px] overflow-y-auto p-1">
            {frames.map((frame) => (
              <div
                key={frame.id}
                className="relative aspect-video bg-black rounded-lg border border-slate-800 overflow-hidden group shadow-sm"
              >
                <img
                  src={getFullImageUrl(frame.imageUrl)}
                  alt={`Frame ${frame.frameIndex}`}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end justify-between p-2 text-[10px] font-mono text-slate-300">
                  <span>#{frame.frameIndex}</span>
                  <span>{frame.timestamp.toFixed(1)}s</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
