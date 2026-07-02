import { useState, useEffect, useCallback } from 'react';
import SourceList from './SourceList';
import DropZone from './DropZone';
import IngestionSummary from './IngestionSummary';
import { ingestionStats } from '../../data/demoData';
import {
  getIngestionStatus,
  ingestFile,
  sourceTypeFromPath,
  syncGoogleWorkspace,
  type IngestionJob,
} from '../../lib/tauri';
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

  // Google Workspace API sync state
  const [apiKey, setApiKey] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [query, setQuery] = useState('subject:(supply OR risk OR port OR logistics OR invoice)');
  const [syncGmail, setSyncGmail] = useState(true);
  const [syncDrive, setSyncDrive] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncMsg, setSyncMsg] = useState('');

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
    const optimistic: FileItem[] = paths.map((p, i) => ({
      id: `pending-${Date.now()}-${i}`,
      name: p.split('/').pop() ?? p,
      type: p.split('.').pop()?.toLowerCase() ?? 'pdf',
      size: '',
      status: 'queued',
      stageText: 'Queued',
    }));
    setFiles(prev => [...optimistic, ...prev]);

    for (const path of paths) {
      try {
        await ingestFile(path, sourceTypeFromPath(path));
      } catch (err) {
        console.error('Ingestion failed for', path, err);
      }
    }
    await loadJobs();
  }, [loadJobs]);

  const handleGoogleSync = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncStatus('syncing');
    setSyncMsg('Connecting to Google Workspace and listing files...');

    try {
      const result = await syncGoogleWorkspace({
        api_key: apiKey,
        client_id: clientId,
        client_secret: clientSecret,
        query,
        sync_gmail: syncGmail,
        sync_drive: syncDrive,
      });

      if (result.success) {
        setSyncStatus('success');
        setSyncMsg(result.message);
        await loadJobs(); // Reload jobs list to show new ingested files
      } else {
        setSyncStatus('error');
        setSyncMsg(result.message);
      }
    } catch (err) {
      setSyncStatus('error');
      setSyncMsg(String(err));
    }
  };

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

        {activeSource === 'src-google' ? (
          /* Google Workspace API sync panel */
          <div style={{
            padding: 'var(--space-xl)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-lg)',
            background: 'var(--bg-surface)',
          }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, fontFamily: "'Inter Tight', sans-serif" }}>
                Google Workspace Live Integration
              </h3>
              <p style={{ margin: 'var(--space-xs) 0 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                Sync communications and document streams directly into your sovereign supply chain knowledge graph.
              </p>
            </div>

            <form onSubmit={handleGoogleSync} style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 520 }}>
              <div className="settings-field">
                <label className="settings-field__label">Google API Key / OAuth Token</label>
                <input
                  className="settings-field__input"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter token (leave blank to run local mock sync simulation)..."
                />
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  🔑 Leave empty to run the mock sync pipeline.
                </span>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div className="settings-field" style={{ flex: 1 }}>
                  <label className="settings-field__label">OAuth Client ID</label>
                  <input
                    className="settings-field__input"
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="Optional client id..."
                  />
                </div>
                <div className="settings-field" style={{ flex: 1 }}>
                  <label className="settings-field__label">OAuth Client Secret</label>
                  <input
                    className="settings-field__input"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="Optional client secret..."
                  />
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-field__label">Gmail Search Query Filter</label>
                <input
                  className="settings-field__input"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. subject:(supply OR risk OR port)"
                />
              </div>

              <div style={{ display: 'flex', gap: 24, padding: '4px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={syncGmail}
                    onChange={(e) => setSyncGmail(e.target.checked)}
                  />
                  Sync Gmail Messages
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={syncDrive}
                    onChange={(e) => setSyncDrive(e.target.checked)}
                  />
                  Sync Google Drive Documents
                </label>
              </div>

              {/* Status block */}
              {syncStatus !== 'idle' && (
                <div style={{
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12,
                  background: syncStatus === 'syncing' ? 'rgba(52,152,219,0.1)' : syncStatus === 'success' ? 'rgba(46,204,113,0.1)' : 'rgba(231,76,60,0.1)',
                  color: syncStatus === 'syncing' ? 'var(--accent-cool)' : syncStatus === 'success' ? 'var(--signal-green)' : 'var(--signal-red)',
                  border: '1px solid currentColor',
                  opacity: 0.9,
                }}>
                  {syncStatus === 'syncing' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="spinner" style={{ width: 12, height: 12, border: '2px solid', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      {syncMsg}
                    </div>
                  )}
                  {syncStatus !== 'syncing' && syncMsg}
                </div>
              )}

              <button
                type="submit"
                className="btn btn--primary"
                style={{ width: 'fit-content', padding: '10px 24px' }}
                disabled={syncStatus === 'syncing'}
              >
                {syncStatus === 'syncing' ? 'Syncing...' : 'Start Workspace Sync'}
              </button>
            </form>
          </div>
        ) : (
          <DropZone files={files} onFilesAdded={handleFilesAdded} />
        )}
      </div>
      <IngestionSummary
        entityCount={totalEntities}
        relationshipCount={totalRelationships}
      />
    </div>
  );
}
