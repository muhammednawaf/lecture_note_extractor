import React, { useState, useRef } from 'react';
import { Youtube, Upload, FileVideo, AlertCircle, ArrowRight, Check } from 'lucide-react';

interface VideoInputProps {
  onYouTubeSelected: (url: string, videoId: string, title?: string) => void;
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

export function extractYouTubeId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

export const VideoInput: React.FC<VideoInputProps> = ({
  onYouTubeSelected,
  onFileSelected,
  disabled,
}) => {
  const [sourceMode, setSourceMode] = useState<'YOUTUBE' | 'UPLOAD'>('YOUTUBE');
  const [url, setUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sampleLectures = [
    { title: 'Stanford CS229 ML', url: 'https://www.youtube.com/watch?v=jGwO_UgTS7I' },
    { title: 'MIT 6.006 Algorithms', url: 'https://www.youtube.com/watch?v=ZA-tUyM_y7s' },
    { title: 'Linear Algebra (3B1B)', url: 'https://www.youtube.com/watch?v=fNk_zzaMoSs' },
  ];

  const handleYouTubeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const videoId = extractYouTubeId(url.trim());
    if (!videoId) {
      setError('Please enter a valid YouTube video URL (e.g. https://www.youtube.com/watch?v=...)');
      return;
    }

    onYouTubeSelected(url.trim(), videoId);
  };

  const handleSelectSample = (sampleUrl: string, title: string) => {
    setUrl(sampleUrl);
    setError(null);
    const videoId = extractYouTubeId(sampleUrl);
    if (videoId) {
      onYouTubeSelected(sampleUrl, videoId, title);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('video/') && !file.name.match(/\.(mp4|webm|mov|mkv)$/i)) {
        setError('Please select a valid video file (.mp4, .webm, .mov, or .mkv)');
        return;
      }
      setSelectedFile(file);
      onFileSelected(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (disabled) return;
    setError(null);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (!file.type.startsWith('video/') && !file.name.match(/\.(mp4|webm|mov|mkv)$/i)) {
        setError('Please drop a valid video file (.mp4, .webm, .mov, or .mkv)');
        return;
      }
      setSelectedFile(file);
      onFileSelected(file);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-sm space-y-4">
      {/* Segmented Source Mode Tabs */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800/80">
          <button
            type="button"
            onClick={() => {
              setSourceMode('YOUTUBE');
              setError(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${sourceMode === 'YOUTUBE'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
              }`}
          >
            <Youtube className="w-3.5 h-3.5 text-red-500" />
            <span>YouTube URL</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSourceMode('UPLOAD');
              setError(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${sourceMode === 'UPLOAD'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
              }`}
          >
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
            <span>Upload Video File</span>
          </button>
        </div>

        <span className="text-[11px] text-zinc-500 hidden sm:inline">
          {sourceMode === 'YOUTUBE' ? 'Streaming acquisition' : 'Local file decoding'}
        </span>
      </div>

      {/* Tab 1: YouTube Mode */}
      {sourceMode === 'YOUTUBE' && (
        <form onSubmit={handleYouTubeSubmit} className="space-y-3">
          <div className="relative">
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Paste lecture URL: https://www.youtube.com/watch?v=..."
              disabled={disabled}
              className="w-full bg-zinc-950 border border-zinc-700/80 rounded-lg px-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/30 border border-red-900/40 p-2.5 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <span className="text-[11px] text-zinc-500">Preset lectures:</span>
              <div className="flex flex-wrap gap-1">
                {sampleLectures.map((sample, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSelectSample(sample.url, sample.title)}
                    disabled={disabled}
                    className="text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                  >
                    {sample.title}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={disabled || !url.trim()}
              className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-3.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>Load Video</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      )}

      {/* Tab 2: Upload Video File Mode */}
      {sourceMode === 'UPLOAD' && (
        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.webm,.mov,.mkv"
            className="hidden"
            onChange={handleFileInputChange}
            disabled={disabled}
          />

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-zinc-700/80 hover:border-zinc-500 rounded-xl p-6 text-center cursor-pointer transition-colors bg-zinc-950/60"
          >
            <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-2 text-zinc-300">
              <FileVideo className="w-5 h-5 text-emerald-400" />
            </div>

            {selectedFile ? (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{selectedFile.name}</span>
                </p>
                <p className="text-[11px] text-zinc-500">
                  {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB &bull; Click or drop another file to change
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs font-medium text-zinc-200">
                  Drop lecture video file here, or <span className="text-emerald-400 underline">browse</span>
                </p>
                <p className="text-[11px] text-zinc-500">
                  Supports MP4, WebM, MOV, and MKV &bull; High-resolution direct decoding
                </p>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/30 border border-red-900/40 p-2.5 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
