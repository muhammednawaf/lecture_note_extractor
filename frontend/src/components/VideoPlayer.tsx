import React, { useRef, useState, useEffect } from 'react';
import { Play, Clock, Video as VideoIcon } from 'lucide-react';

interface VideoPlayerProps {
  sourceType: 'YOUTUBE' | 'UPLOAD';
  videoId: string | null;
  videoFileUrl: string | null;
  onTimeUpdate?: (seconds: number) => void;
  videoCaptureRef: React.RefObject<HTMLVideoElement> | null;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  sourceType,
  videoId,
  videoFileUrl,
  onTimeUpdate,
  videoCaptureRef,
}) => {
  const [playbackSeconds, setPlaybackSeconds] = useState<number>(0);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setPlaybackSeconds(0);
  }, [videoId, videoFileUrl]);

  const handleManualTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value) || 0;
    setPlaybackSeconds(val);
    if (onTimeUpdate) onTimeUpdate(val);
    if (sourceModeIsUpload && localVideoRef.current) {
      localVideoRef.current.currentTime = val;
    }
  };

  const handleLocalVideoTimeUpdate = () => {
    if (localVideoRef.current) {
      const time = localVideoRef.current.currentTime;
      setPlaybackSeconds(time);
      if (onTimeUpdate) onTimeUpdate(time);
    }
  };

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const sourceModeIsUpload = sourceType === 'UPLOAD';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm flex flex-col">
      {/* Player Screen */}
      <div className="relative aspect-video bg-black w-full flex items-center justify-center">
        {!sourceModeIsUpload && videoId && (
          <iframe
            id="yt-player-iframe"
            className="w-full h-full border-0"
            src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&origin=${window.location.origin}&rel=0`}
            title="Lecture Video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        )}

        {sourceModeIsUpload && videoFileUrl && (
          <video
            ref={(node) => {
              localVideoRef.current = node;
            }}
            src={videoFileUrl}
            controls
            playsInline
            onTimeUpdate={handleLocalVideoTimeUpdate}
            className="w-full h-full object-contain"
          />
        )}

        {((!sourceModeIsUpload && !videoId) || (sourceModeIsUpload && !videoFileUrl)) && (
          <div className="flex flex-col items-center justify-center text-zinc-500 p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-2">
              <Play className="w-5 h-5 text-zinc-600 ml-0.5" />
            </div>
            <p className="text-xs font-medium text-zinc-400">No lecture video loaded</p>
            <p className="text-[11px] text-zinc-600 mt-1">
              Enter a YouTube URL or select a video file above to preview.
            </p>
          </div>
        )}

      </div>

      {/* Sync bar */}
      {((!sourceModeIsUpload && videoId) || (sourceModeIsUpload && videoFileUrl)) && (
        <div className="px-4 py-2.5 bg-zinc-950 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-mono text-zinc-200">{formatTime(playbackSeconds)}</span>
            <span className="text-zinc-600">({playbackSeconds.toFixed(1)}s)</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <label className="text-zinc-500 text-[11px]">Timestamp Sync:</label>
            <input
              type="number"
              min="0"
              step="1"
              value={playbackSeconds}
              onChange={handleManualTimeChange}
              className="w-16 bg-zinc-900 border border-zinc-700/80 rounded px-2 py-0.5 text-zinc-200 text-xs focus:outline-none focus:border-zinc-500"
            />
          </div>
        </div>
      )}
    </div>
  );
};
