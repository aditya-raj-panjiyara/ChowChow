import { useState, useEffect, useCallback } from 'react';
import SourceList from './SourceList';
import DropZone from './DropZone';
import IngestionSummary from './IngestionSummary';
import { ingestionStats } from '../../data/demoData';
import { getIngestionStatus, ingestFile, sourceTypeFromPath, type IngestionJob } from '../../lib/tauri';
import type { FileItem, FileStatus } from '../../types';

function jobToFileItem(job: IngestionJob): FileItem {
  const name = job.file_path.split('/').pop() ?? job.file_path;
  const ext = name.split('.').pop()?.toLowerCase() ?? 'pdf';
  const status = mapStatus(job.status);
  return {
    id: job.id,
    name,
    type: ext,
    size: job.entities_extracted != null
      ? `${job.entities_extracted} entities`
      : '',
    status,
    stageText: stageLabel(job),
    error: job.error_message ?? undefined,
  };
}

function mapStatus(s: string): FileStatus {
  switch (s) {
    case 'complete': return 'complete';
    case 'processing': return 'extracting';
    case 'queued': return 'queued';
    case 'failed': return 'failed';
    default: return 'queued';
  }
}

function stageLabel(job: IngestionJob): string {
  switch (job.status) {
    case 'complete':
      return job.entities_extracted != null
        ? `${job.entities_extracted} entities, ${job.relationships_extracted} relationships`
        : 'Done';
    case 'processing': return 'Extracting entities…';
    case 'queued': return 'Queued';
    case 'failed': return 'Failed';
    default: return '';
  }
}

export default function Ingestion() {
  const [activeSource, setActiveSource] = useState('src-erp');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [totalEntities, setTotalEntities] = useState(ingestionStats.entityCount);
  const [totalRelationships, setTotalRelationships] = useState(ingestionStats.relationshipCount);

  const loadJobs = useCallback(async () => {
    try {
      const jobs = await getIngestionStatus();
      setFiles(jobs.map(jobToFileItem));
      const completedJobs = jobs.filter(j => j.status === 'complete');
      if (completedJobs.length > 0) {
        setTotalEntities(completedJobs.reduce((sum, j) => sum + (j.entities_extracted ?? 0), 0));
        setTotalRelationships(completedJobs.reduce((sum, j) => sum + (j.relationships_extracted ?? 0), 0));
      }
    } catch {
      // Backend not running — keep demo stats, no files
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Poll while any file is in-progress
  useEffect(() => {
    const hasInProgress = files.some(f => f.status === 'queued' || f.status === 'extracting');
    if (!hasInProgress) return;
    const timer = setInterval(loadJobs, 1500);
    return () => clearInterval(timer);
  }, [files, loadJobs]);

  const handleFilesAdded = useCallback(async (paths: string[]) => {
    // Optimistically add queued items
    const optimistic: FileItem[] = paths.map((p, i) => ({
      id: `pending-${Date.now()}-${i}`,
      name: p.split('/').pop() ?? p,
      type: p.split('.').pop()?.toLowerCase() ?? 'pdf',
      size: '',
      status: 'queued',
      stageText: 'Queued',
    }));
    setFiles(prev => [...optimistic, ...prev]);

    // Ingest each file sequentially
    for (const path of paths) {
      try {
        await ingestFile(path, sourceTypeFromPath(path));
      } catch (err) {
        console.error('Ingestion failed for', path, err);
      }
    }
    await loadJobs();
  }, [loadJobs]);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      margin: 'calc(-1 * var(--space-lg))',
    }}>
      <div className="grid-2-pane" style={{ flex: 1, overflow: 'hidden' }}>
        <SourceList
          activeSourceId={activeSource}
          onSelectSource={setActiveSource}
        />
        <DropZone files={files} onFilesAdded={handleFilesAdded} />
      </div>
      <IngestionSummary
        entityCount={totalEntities}
        relationshipCount={totalRelationships}
      />
    </div>
  );
}
