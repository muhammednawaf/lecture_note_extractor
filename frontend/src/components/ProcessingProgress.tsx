import React from 'react';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface ProcessingProgressProps {
  status: string;
  totalFrames: number;
  totalPages: number;
}

export const ProcessingProgress: React.FC<ProcessingProgressProps> = ({
  status,
  totalFrames,
  totalPages,
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Pipeline Status</h3>
        <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
          {status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
          <p className="text-xs text-slate-400">Frames Captured</p>
          <p className="text-xl font-bold font-mono text-emerald-400">{totalFrames}</p>
        </div>
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
          <p className="text-xs text-slate-400">Pages Generated</p>
          <p className="text-xl font-bold font-mono text-sky-400">{totalPages}</p>
        </div>
      </div>
    </div>
  );
};

