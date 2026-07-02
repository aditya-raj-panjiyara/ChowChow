import type { FileItem } from '../../types';
import type { ReactNode } from 'react';
import StatusPill from '../../components/StatusPill';

interface FileRowProps {
  file: FileItem;
}

const typeIcons: Record<string, ReactNode> = {
  pdf: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--signal-red)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" opacity="0.7">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  csv: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--signal-green)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" opacity="0.7">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  ),
  xlsx: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--signal-green)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" opacity="0.7">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <rect x="8" y="12" width="8" height="6" rx="1" />
    </svg>
  ),
  eml: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cool)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" opacity="0.7">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
};

/**
 * FileRow — single file in the ingestion list.
 * Shows filename (mono), file type icon, size, and pipeline status pill.
 * Failed files show an inline error expand.
 */
export default function FileRow({ file }: FileRowProps) {
  return (
    <div className="file-row">
      <div className="file-row__icon">
        {typeIcons[file.type] || typeIcons['pdf']}
      </div>
      <span className="file-row__name">{file.name}</span>
      <span className="file-row__stage text-mono-sm">{file.size}</span>
      <StatusPill status={file.status} stageText={file.stageText !== 'Done' ? file.stageText : undefined} />
      {file.status === 'failed' && file.error && (
        <button className="btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }}>
          View error
        </button>
      )}
    </div>
  );
}
