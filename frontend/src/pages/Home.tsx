import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  AlertCircle,
  CheckCircle,
  FileCheck2,
  Sparkles,
} from 'lucide-react';

import { VideoInput } from '../components/VideoInput';
import { VideoPlayer } from '../components/VideoPlayer';
import { CaptureControls } from '../components/CaptureControls';
import { videoApi } from '../services/api';
import { ApiHealth, Job, JobStatus } from '../types';

const POLL_INTERVAL_MS = 1500; // Poll job status every 1.5s while active

export const Home: React.FC = () => {
  const navigate = useNavigate();

  // ─── Video source state ───────────────────────────────────────────────────
  const [sourceType, setSourceType] = useState<'YOUTUBE' | 'UPLOAD'>('YOUTUBE');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoFileUrl, setVideoFileUrl] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState<string>('Lecture Video');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // ─── Job state ────────────────────────────────────────────────────────────
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  // ─── Extraction state ─────────────────────────────────────────────────────
  const [fps, setFps] = useState<number>(1);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  // ─── Health ───────────────────────────────────────────────────────────────
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);

  // ─── Polling ref ──────────────────────────────────────────────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check backend health on mount
  useEffect(() => {
    videoApi
      .checkHealth()
      .then((h) => {
        setHealth(h);
        setBackendError(null);
      })
      .catch(() => {
        setBackendError('Backend not reachable at http://localhost:8000. Start backend with `npm run dev`');
      });
  }, []);

  // ─── Polling: keep job state updated ─────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (jobId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const job = await videoApi.getJob(jobId);
          setCurrentJob(job);

          if (job.status === 'COMPLETED') {
            stopPolling();
            // Seamlessly open the generated PDF notes review screen!
            setTimeout(() => {
              navigate(`/review?jobId=${job.id}`);
            }, 1000);
          } else if (job.status === 'FAILED') {
            stopPolling();
            setJobError('Processing failed. Please check the video URL or file.');
          }
        } catch {
          // Keep polling
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, navigate]
  );

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  // ─── Handlers: YouTube URL selected ──────────────────────────────────────
  const handleYouTubeSelected = async (url: string, id: string, title?: string) => {
    setJobError(null);
    setSourceType('YOUTUBE');
    setVideoUrl(url);
    setVideoId(id);
    setVideoFileUrl(null);
    setSelectedFile(null);
    setUploadProgress(0);
    stopPolling();

    const titleVal = title || 'YouTube Lecture';
    setVideoTitle(titleVal);

    try {
      const job = await videoApi.createJob({
        youtubeUrl: url,
        videoTitle: titleVal,
        sourceType: 'YOUTUBE',
      });
      setCurrentJob(job);
    } catch (err: any) {
      setJobError(`Failed to create job: ${err.message}`);
    }
  };

  // ─── Handlers: Local file selected ───────────────────────────────────────
  const handleFileSelected = async (file: File) => {
    setJobError(null);
    setSourceType('UPLOAD');
    setVideoId(null);
    setVideoUrl('');
    setUploadProgress(0);
    stopPolling();

    const localUrl = URL.createObjectURL(file);
    setVideoFileUrl(localUrl);
    setSelectedFile(file);

    const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
    setVideoTitle(cleanTitle);

    try {
      const job = await videoApi.createJob({
        youtubeUrl: '',
        videoTitle: cleanTitle,
        sourceType: 'UPLOAD',
      });
      setCurrentJob(job);
    } catch (err: any) {
      setJobError(`Failed to create job: ${err.message}`);
    }
  };

  // ─── Handlers: Trigger extraction & note generation ─────────────────────
  const handleExtract = async () => {
    if (!currentJob) return;
    setJobError(null);
    setUploadProgress(0);

    try {
      if (sourceType === 'YOUTUBE') {
        await videoApi.extractFromYouTube(currentJob.id, fps);
        setCurrentJob((prev) => (prev ? { ...prev, status: 'DOWNLOADING' } : prev));
        startPolling(currentJob.id);
      } else {
        if (!selectedFile) {
          setJobError('No file selected. Please choose a video file first.');
          return;
        }
        await videoApi.uploadVideoFile(currentJob.id, selectedFile, fps, (pct) => {
          setUploadProgress(pct);
        });
        setCurrentJob((prev) => (prev ? { ...prev, status: 'EXTRACTING' } : prev));
        startPolling(currentJob.id);
      }
    } catch (err: any) {
      setJobError(`Extraction failed: ${err.message}`);
    }
  };

  // ─── Derived state ────────────────────────────────────────────────────────
  const jobStatus = currentJob?.status ?? null;
  const totalFrames = currentJob?.totalFrames ?? 0;
  const totalPages = currentJob?.totalPages ?? 0;
  const hasVideoOrUrl = sourceType === 'YOUTUBE' ? !!videoUrl : !!selectedFile;
  const isCompleted = jobStatus === 'COMPLETED';

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-zinc-100">Video2PDF</h1>
            <span className="text-[11px] font-mono bg-zinc-800 text-zinc-400 border border-zinc-700/80 px-2 py-0.5 rounded">
              {sourceType === 'YOUTUBE' ? 'YouTube Lecture Mode' : 'Local Video File Mode'}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Convert lecture videos and handwritten notebook pages into organized PDF notes.
          </p>
        </div>

        {backendError && (
          <div className="flex items-center gap-1.5 bg-red-950/30 border border-red-900/40 px-3 py-1.5 rounded-lg text-red-400 text-xs">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{backendError}</span>
          </div>
        )}
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols): Input & Player */}
        <div className="lg:col-span-7 space-y-5">
          <VideoInput
            onYouTubeSelected={handleYouTubeSelected}
            onFileSelected={handleFileSelected}
            disabled={jobStatus === 'DOWNLOADING' || jobStatus === 'EXTRACTING' || jobStatus === 'PROCESSING'}
          />

          <VideoPlayer
            sourceType={sourceType}
            videoId={videoId}
            videoFileUrl={videoFileUrl}
            onTimeUpdate={() => {}}
            videoCaptureRef={null}
          />
        </div>

        {/* Right Column (5 cols): Controls & Clean Output Card */}
        <div className="lg:col-span-5 space-y-5">
          <CaptureControls
            sourceType={sourceType}
            jobStatus={jobStatus}
            totalFrames={totalFrames}
            totalPages={totalPages}
            uploadProgress={uploadProgress}
            error={jobError}
            fps={fps}
            hasJob={!!currentJob}
            hasVideoOrUrl={hasVideoOrUrl}
            onExtract={handleExtract}
            onFpsChange={setFps}
            onViewNotes={() => currentJob && navigate(`/review?jobId=${currentJob.id}`)}
          />

          {/* Clean Output Information Card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-semibold text-zinc-200">
                  Document Notes Output
                </h3>
              </div>
              {isCompleted && currentJob && (
                <button
                  onClick={() => navigate(`/review?jobId=${currentJob.id}`)}
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                >
                  Open Notes &rarr;
                </button>
              )}
            </div>

            <div className="bg-zinc-950 border border-dashed border-zinc-800 rounded-lg p-5 text-center text-zinc-500">
              {jobStatus === 'COMPLETED' ? (
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-full bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center mx-auto text-emerald-400">
                    <CheckCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-zinc-100">
                      {totalPages > 0 ? `${totalPages} Clean Pages Ready` : 'Notes Generated!'}
                    </p>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      All zoom snippets and duplicate transitions filtered out.
                    </p>
                  </div>
                </div>
              ) : jobStatus === 'PROCESSING' || jobStatus === 'EXTRACTING' || jobStatus === 'DOWNLOADING' ? (
                <div className="space-y-2">
                  <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-emerald-400 animate-pulse">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <p className="text-xs font-medium text-zinc-300">
                    {jobStatus === 'DOWNLOADING' && 'Downloading lecture from YouTube...'}
                    {jobStatus === 'EXTRACTING' && `Extracting lecture frames (${totalFrames} frames)...`}
                    {jobStatus === 'PROCESSING' && 'Filtering notebook pages & removing zoom crops...'}
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    You will be redirected automatically once your notes are ready.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <FileText className="w-6 h-6 mx-auto text-zinc-700" />
                  <p className="text-xs text-zinc-400">Ready to convert</p>
                  <p className="text-[11px] text-zinc-600">
                    Select a lecture above and click &quot;Convert Lecture to PDF Notes&quot;.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
