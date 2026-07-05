import { useState } from 'react';
import { forgetAllMemory, type ForgetSummary } from '../../lib/tauri';

/**
 * ResetSection — the "right to be forgotten", backed by cognee's forget()
 * API: a cascading hard delete across the relational DB, knowledge graph,
 * vector store, and file storage (plus this app's own bookkeeping tables).
 * Requires the user to type "FORGET" — protects against accidental clicks.
 */
export default function ResetSection() {
  const [showModal, setShowModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [summary, setSummary] = useState<ForgetSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleForget = async () => {
    if (confirmText !== 'FORGET' || status === 'working') return;
    setStatus('working');
    setErrorMsg('');
    try {
      const result = await forgetAllMemory();
      setSummary(result);
      setStatus('done');
      setShowModal(false);
      setConfirmText('');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Danger Zone</h3>
      <div style={{
        padding: 'var(--space-lg)',
        border: '1px solid rgba(217, 83, 79, 0.3)',
        borderRadius: 'var(--radius-lg)',
        background: 'rgba(217, 83, 79, 0.05)',
      }}>
        <p style={{ fontSize: 13, marginBottom: 'var(--space-md)' }}>
          Forget all memory — cognee's <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>forget()</code> cascades
          a hard delete across every backend: ingested documents, the knowledge graph,
          vector embeddings, file storage, plus alerts and the corrections log.
          Unlike deleting a node (a recoverable tombstone), this is permanent.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn--danger" onClick={() => { setStatus('idle'); setShowModal(true); }}>
            Forget all memory
          </button>
          {status === 'done' && summary && (
            <span style={{ fontSize: 12, color: 'var(--signal-green)' }}>
              ✓ Forgotten — {summary.graph_nodes_removed} graph nodes, {summary.vector_points_removed} vector
              points, {summary.documents_removed} documents, {summary.files_removed} files erased.
            </span>
          )}
          {status === 'error' && (
            <span style={{ fontSize: 12, color: 'var(--signal-red)' }} title={errorMsg}>
              ⚠ Forget failed: {errorMsg.substring(0, 60)}
            </span>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => status !== 'working' && setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title" style={{ color: 'var(--signal-red)' }}>
              Confirm Forget
            </h3>
            <p className="modal__text">
              This action cannot be undone. cognee will permanently erase all ingested
              documents, the entire knowledge graph, all vector embeddings, and stored
              files — alerts and the corrections log go with them.
            </p>
            <div className="settings-field" style={{ marginBottom: 'var(--space-lg)' }}>
              <label className="settings-field__label">
                Type <strong style={{ fontFamily: "'JetBrains Mono'", color: 'var(--signal-red)' }}>FORGET</strong> to confirm
              </label>
              <input
                className="settings-field__input"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleForget()}
                placeholder="Type FORGET..."
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
                autoFocus
                disabled={status === 'working'}
              />
            </div>
            {status === 'error' && (
              <p style={{ fontSize: 12, color: 'var(--signal-red)', marginBottom: 'var(--space-md)' }}>
                {errorMsg}
              </p>
            )}
            <div className="modal__actions">
              <button
                className="btn btn--ghost"
                onClick={() => { setShowModal(false); setConfirmText(''); }}
                disabled={status === 'working'}
              >
                Cancel
              </button>
              <button
                className="btn btn--danger"
                onClick={handleForget}
                disabled={confirmText !== 'FORGET' || status === 'working'}
                style={{ opacity: confirmText === 'FORGET' && status !== 'working' ? 1 : 0.4 }}
              >
                {status === 'working' ? 'Forgetting…' : 'Forget everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
