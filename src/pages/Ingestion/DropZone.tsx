import { useEffect, useRef } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { FileItem } from '../../types';
import { pickFiles } from '../../lib/tauri';
import FileRow from './FileRow';

interface DropZoneProps {
  files: FileItem[];
  onFilesAdded: (paths: string[]) => void;
}

/**
 * DropZone — right panel of the Ingestion tab.
 * Drag-and-drop area when empty, file list when populated.
 * Listens to Tauri drag-drop events for real file paths.
 */
export default function DropZone({ files, onFilesAdded }: DropZoneProps) {
  const hasFiles = files.length > 0;
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const appWindow = getCurrentWebviewWindow();
    appWindow.onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        const paths = event.payload.paths;
        if (paths.length > 0) onFilesAdded(paths);
      }
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });

    return () => {
      unlistenRef.current?.();
    };
  }, [onFilesAdded]);

  const handleBrowse = async () => {
    const paths = await pickFiles();
    if (paths.length > 0) onFilesAdded(paths);
  };

  return (
    <div style={{
      flex: 1,
      padding: 'var(--space-lg)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-md)',
      overflow: 'hidden',
    }}>
      {/* Drop zone area — always visible at top */}
      <div
        className="drop-zone"
        role="button"
        tabIndex={0}
        onClick={handleBrowse}
        onKeyDown={(e) => e.key === 'Enter' && handleBrowse()}
      >
        <div className="drop-zone__icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16" />
            <line x1="12" y1="12" x2="12" y2="21" />
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
          </svg>
        </div>
        <p className="drop-zone__text">
          Drag files here, or <strong>browse</strong>
        </p>
        <p className="text-caption">
          Supports PDF, CSV, XLSX, EML files
        </p>
      </div>

      {/* File list */}
      {hasFiles && (
        <div style={{
          flex: 1,
          overflow: 'auto',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-lg)',
        }}>
          <div style={{ padding: 'var(--space-sm)' }}>
            {files.map(file => (
              <FileRow key={file.id} file={file} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
