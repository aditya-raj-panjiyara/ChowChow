import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import SourceList from './SourceList';
import DropZone from './DropZone';
import IngestionSummary from './IngestionSummary';
import { ingestionStats } from '../../data/demoData';
import {
  getIngestionStatus,
  ingestFile,
  sourceTypeFromPath,
  syncGoogleWorkspace,
  googleAuthStatus,
  googleConnect,
  googleDisconnect,
  type GoogleAuthStatus,
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
  const navigate = useNavigate();
  const [activeSource, setActiveSource] = useState('src-erp');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [totalEntities, setTotalEntities] = useState(ingestionStats.entityCount);
  const [totalRelationships, setTotalRelationships] = useState(ingestionStats.relationshipCount);

  // Google Workspace sync state — credentials live in .env, tokens in the
  // backend; the UI only knows "configured / connected / who".
  const [gAuth, setGAuth] = useState<GoogleAuthStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [query, setQuery] = useState('subject:(supply OR risk OR port OR logistics OR invoice)');
  const [syncGmail, setSyncGmail] = useState(true);
  const [syncDrive, setSyncDrive] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncMsg, setSyncMsg] = useState('');

  const refreshGoogleAuth = useCallback(async () => {
    try {
      setGAuth(await googleAuthStatus());
    } catch {
      setGAuth(null); // backend not running
    }
  }, []);

  useEffect(() => {
    refreshGoogleAuth();
  }, [refreshGoogleAuth]);

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

  const runGoogleSync = useCallback(async () => {
    setSyncStatus('syncing');
    setSyncMsg('Syncing Gmail and Drive into the knowledge graph…');
    try {
      const result = await syncGoogleWorkspace({
        query,
        sync_gmail: syncGmail,
        sync_drive: syncDrive,
      });
      setSyncStatus(result.success ? 'success' : 'error');
      setSyncMsg(result.message);
      await loadJobs();
    } catch (err) {
      setSyncStatus('error');
      setSyncMsg(String(err));
    }
  }, [query, syncGmail, syncDrive, loadJobs]);

  // The single button: browser consent → tokens stored → immediate first sync.
  const handleGoogleConnect = useCallback(async () => {
    setConnecting(true);
    setSyncStatus('syncing');
    setSyncMsg('Browser opened — sign in with Google and approve access…');
    try {
      const status = await googleConnect();
      setGAuth(status);
      setSyncMsg(`Connected as ${status.email ?? 'Google account'} — starting first sync…`);
      await runGoogleSync();
    } catch (err) {
      setSyncStatus('error');
      setSyncMsg(String(err));
    } finally {
      setConnecting(false);
    }
  }, [runGoogleSync]);

  const handleGoogleDisconnect = useCallback(async () => {
    try {
      await googleDisconnect();
      setSyncStatus('idle');
      setSyncMsg('');
      await refreshGoogleAuth();
    } catch (err) {
      setSyncStatus('error');
      setSyncMsg(String(err));
    }
  }, [refreshGoogleAuth]);

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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 520 }}>
              {/* Connection state — the only credential UI is one button */}
              {gAuth?.connected ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                  borderRadius: 'var(--radius-md)', background: 'rgba(95,168,138,0.1)',
                  border: '1px solid var(--signal-green)',
                }}>
                  <span className="sovereignty-badge sovereignty-badge--local">● Connected</span>
                  <span style={{ flex: 1, fontSize: 12.5 }} className="text-mono-sm">
                    {gAuth.email ?? 'Google account'}
                  </span>
                  <button
                    className="btn btn--ghost"
                    style={{ fontSize: 11, padding: '4px 10px' }}
                    onClick={handleGoogleDisconnect}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    className="btn btn--primary"
                    style={{ width: 'fit-content', padding: '12px 28px', fontSize: 14 }}
                    disabled={connecting || gAuth?.configured === false}
                    onClick={handleGoogleConnect}
                  >
                    {connecting ? 'Waiting for browser sign-in…' : '🔗 Connect Google Workspace'}
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    {gAuth?.configured === false ? (
                      <>No OAuth credentials found — copy <span className="text-mono-sm">.env.example</span> to{' '}
                      <span className="text-mono-sm">.env</span>, add your <span className="text-mono-sm">GOOGLE_CLIENT_ID</span> and{' '}
                      <span className="text-mono-sm">GOOGLE_CLIENT_SECRET</span>, restart the app. Sync below runs in demo mode until then.</>
                    ) : (
                      <>Opens your browser for Google consent — credentials come from <span className="text-mono-sm">.env</span>, tokens are stored locally and refreshed automatically. First sync starts right after connecting.</>
                    )}
                  </span>
                </div>
              )}

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

              {(gAuth?.connected || gAuth?.configured === false) && (
                <button
                  className="btn btn--primary"
                  style={{ width: 'fit-content', padding: '10px 24px' }}
                  disabled={syncStatus === 'syncing'}
                  onClick={runGoogleSync}
                >
                  {syncStatus === 'syncing'
                    ? 'Syncing…'
                    : gAuth?.connected
                      ? 'Sync now'
                      : 'Run demo sync'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <DropZone files={files} onFilesAdded={handleFilesAdded} />
        )}
      </div>

      {/* Live handoff — extraction streams into the Graph Explorer in real time */}
      {files.some(f => f.status === 'queued' || f.status === 'extracting') && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
          background: 'var(--bg-surface)', borderTop: '1px solid var(--signal-green)',
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: 'var(--signal-green)',
            animation: 'pulse-dot 1.2s ease-in-out infinite', flexShrink: 0,
          }} />
          <span style={{ fontSize: 12.5, color: 'var(--text-primary)', flex: 1 }}>
            Extraction running — entities and relationships stream into the knowledge graph as cognee discovers them.
          </span>
          <button
            className="btn btn--primary"
            style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}
            onClick={() => navigate('/graph')}
          >
            Watch it grow live →
          </button>
        </div>
      )}

      <IngestionSummary
        entityCount={totalEntities}
        relationshipCount={totalRelationships}
      />
    </div>
  );
}
