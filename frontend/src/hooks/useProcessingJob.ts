import { useState, useRef, useCallback, useEffect } from 'react';
import { Job, CapturedFrame } from '../types';
import { videoApi } from '../services/api';

export interface UseProcessingJobReturn {
  currentJob: Job | null;
  capturedFrames: CapturedFrame[];
  isSampling: boolean;
  sampleFps: number;
  totalUploaded: number;
  isUploading: boolean;
  error: string | null;
  setSampleFps: (fps: number) => void;
  initializeJob: (
    youtubeUrl: string,
    videoTitle?: string,
    sourceType?: 'YOUTUBE' | 'UPLOAD'
  ) => Promise<Job | null>;
  startSampling: (captureFrameFn: () => Promise<Blob | null>, getCurrentTimeFn: () => number) => void;
  stopSampling: () => void;
  resetJob: () => void;
}

export function useProcessingJob(): UseProcessingJobReturn {
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const [capturedFrames, setCapturedFrames] = useState<CapturedFrame[]>([]);
  const [isSampling, setIsSampling] = useState<boolean>(false);
  const [sampleFps, setSampleFps] = useState<number>(1.0); // 1 frame per second standard sampling
  const [totalUploaded, setTotalUploaded] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const frameIndexRef = useRef<number>(0);
  const samplingIntervalRef = useRef<any>(null);
  const isUploadingRef = useRef<boolean>(false);

  // Initialize new Job on backend
  const initializeJob = useCallback(
    async (
      youtubeUrl: string,
      videoTitle?: string,
      sourceType?: 'YOUTUBE' | 'UPLOAD'
    ): Promise<Job | null> => {
      setError(null);
      try {
        const job = await videoApi.createJob({
          youtubeUrl,
          videoTitle: videoTitle || 'Lecture Video',
          sourceType: sourceType || (youtubeUrl ? 'YOUTUBE' : 'UPLOAD'),
        });
        setCurrentJob(job);
        setCapturedFrames([]);
        setTotalUploaded(0);
        frameIndexRef.current = 0;
        return job;
      } catch (err: any) {
        const msg = err.response?.data?.error || err.message || 'Failed to initialize processing job';
        setError(msg);
        return null;
      }
    },
    []
  );

  // Stop sampling loop
  const stopSampling = useCallback(() => {
    if (samplingIntervalRef.current) {
      clearInterval(samplingIntervalRef.current);
      samplingIntervalRef.current = null;
    }
    setIsSampling(false);

    if (currentJob) {
      videoApi.updateJob(currentJob.id, { status: 'CAPTURED' }).catch(console.error);
    }
  }, [currentJob]);

  // Start periodic frame sampling
  const startSampling = useCallback(
    (captureFrameFn: () => Promise<Blob | null>, getCurrentTimeFn: () => number) => {
      if (!currentJob) {
        setError('Cannot start sampling without an active processing job');
        return;
      }

      setIsSampling(true);
      setError(null);

      const intervalMs = Math.round(1000 / sampleFps);

      samplingIntervalRef.current = setInterval(async () => {
        // Prevent concurrent uploads blocking the loop
        if (isUploadingRef.current) return;

        try {
          const blob = await captureFrameFn();
          if (!blob) return;

          isUploadingRef.current = true;
          setIsUploading(true);

          const index = frameIndexRef.current++;
          const timestamp = getCurrentTimeFn();

          const frame = await videoApi.uploadFrame(currentJob.id, blob, timestamp, index);

          setCapturedFrames((prev) => [frame, ...prev.slice(0, 49)]); // keep latest 50 for live UI
          setTotalUploaded((prev) => prev + 1);
        } catch (err: any) {
          console.warn('Frame upload error:', err);
        } finally {
          isUploadingRef.current = false;
          setIsUploading(false);
        }
      }, intervalMs);
    },
    [currentJob, sampleFps]
  );

  const resetJob = useCallback(() => {
    stopSampling();
    setCurrentJob(null);
    setCapturedFrames([]);
    setTotalUploaded(0);
    frameIndexRef.current = 0;
    setError(null);
  }, [stopSampling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (samplingIntervalRef.current) {
        clearInterval(samplingIntervalRef.current);
      }
    };
  }, []);

  return {
    currentJob,
    capturedFrames,
    isSampling,
    sampleFps,
    totalUploaded,
    isUploading,
    error,
    setSampleFps,
    initializeJob,
    startSampling,
    stopSampling,
    resetJob,
  };
}
