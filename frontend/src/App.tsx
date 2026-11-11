import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { Home } from './pages/Home';
import { Processing } from './pages/Processing';
import { Review } from './pages/Review';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-zinc-950 flex flex-col text-zinc-100 font-sans antialiased selection:bg-emerald-500/20 selection:text-emerald-200">
        {/* Navigation Bar */}
        <header className="border-b border-zinc-800/80 bg-zinc-900/70 backdrop-blur sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2.5 font-semibold text-sm text-zinc-100 tracking-tight">
              <div className="w-7 h-7 rounded-md bg-emerald-600 flex items-center justify-center shadow-sm">
                <FileText className="w-4 h-4 text-white" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-bold">Video2PDF</span>
                <span className="text-[11px] font-normal text-zinc-500">Lecture Notes Extractor</span>
              </div>
            </Link>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/processing" element={<Processing />} />
            <Route path="/review" element={<Review />} />
          </Routes>
        </main>

        {/* Minimalist Footer */}
        <footer className="border-t border-zinc-900 py-4 text-center text-xs text-zinc-600">
          Video2PDF &bull; Intelligent Lecture to PDF Extractor
        </footer>
      </div>
    </BrowserRouter>
  );
};
