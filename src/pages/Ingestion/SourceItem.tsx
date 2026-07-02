import type { SourceCategory } from '../../types';
import type { ReactNode } from 'react';

interface SourceItemProps {
  source: SourceCategory;
  isActive: boolean;
  onClick: () => void;
}

const sourceIcons: Record<string, ReactNode> = {
  database: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  mail: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  'file-text': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  radio: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M7.76 16.24a6 6 0 0 1 0-8.49" />
      <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
    </svg>
  ),
  sync: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
    </svg>
  ),
};

/**
 * SourceItem — single source category in the ingestion left panel.
 * Active sources are selectable; locked sources show "coming in v2".
 */
export default function SourceItem({ source, isActive, onClick }: SourceItemProps) {
  return (
    <div
      className={`source-item ${isActive ? 'source-item--active' : ''} ${source.locked ? 'source-item--locked' : ''}`}
      onClick={source.locked ? undefined : onClick}
      role={source.locked ? undefined : 'button'}
      tabIndex={source.locked ? -1 : 0}
    >
      <span className="source-item__icon">
        {sourceIcons[source.icon] || sourceIcons['file-text']}
      </span>
      <span className="source-item__name">{source.name}</span>
      {source.locked && source.lockedReason && (
        <span className="source-item__tag">{source.lockedReason}</span>
      )}
    </div>
  );
}
