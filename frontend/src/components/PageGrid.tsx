import React from 'react';
import { ExtractedPage } from '../types';
import { PageCard } from './PageCard';

interface PageGridProps {
  pages: ExtractedPage[];
  onDeletePage: (id: string) => void;
  onRotatePage: (id: string) => void;
  onMovePage: (fromIndex: number, toIndex: number) => void;
  onSelectPage: (page: ExtractedPage) => void;
  onToggleVerify?: (id: string) => void;
}

export const PageGrid: React.FC<PageGridProps> = ({
  pages,
  onDeletePage,
  onRotatePage,
  onMovePage,
  onSelectPage,
  onToggleVerify,
}) => {
  if (pages.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center text-zinc-500">
        <p className="text-sm font-medium text-zinc-400">No extracted pages found</p>
        <p className="text-xs text-zinc-600 mt-1">
          Capture lecture frames and run the processing pipeline first.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {pages.map((page, index) => (
        <PageCard
          key={page.id}
          page={page}
          isFirst={index === 0}
          isLast={index === pages.length - 1}
          onDelete={() => onDeletePage(page.id)}
          onRotate={() => onRotatePage(page.id)}
          onMoveLeft={() => onMovePage(index, index - 1)}
          onMoveRight={() => onMovePage(index, index + 1)}
          onClick={() => onSelectPage(page)}
          onToggleVerify={onToggleVerify ? () => onToggleVerify(page.id) : undefined}
        />
      ))}
    </div>
  );
};
