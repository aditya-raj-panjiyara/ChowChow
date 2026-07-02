import type { FileStatus } from '../types';

interface StatusPillProps {
  status: FileStatus;
  stageText?: string;
}

const statusLabels: Record<FileStatus, string> = {
  queued: 'Queued',
  parsing: 'Parsing',
  extracting: 'Extracting',
  cognify: 'Cognify',
  complete: 'Complete',
  failed: 'Failed',
};

function getStatusClass(status: FileStatus): string {
  switch (status) {
    case 'queued': return 'status-pill--queued';
    case 'parsing':
    case 'extracting':
    case 'cognify': return 'status-pill--processing';
    case 'complete': return 'status-pill--complete';
    case 'failed': return 'status-pill--failed';
  }
}

/**
 * StatusPill — visual state indicator for pipeline status.
 * Queued (grey) → Processing (blue, pulsing) → Complete (green) → Failed (red)
 */
export default function StatusPill({ status, stageText }: StatusPillProps) {
  return (
    <span className={`status-pill ${getStatusClass(status)}`}>
      <span className="status-pill__dot" />
      {stageText || statusLabels[status]}
    </span>
  );
}
