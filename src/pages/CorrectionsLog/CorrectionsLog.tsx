import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import {
  listCorrections,
  submitCorrection,
  confirmCorrection,
  rejectCorrection,
  type CorrectionEntry,
} from '../../lib/tauri';
import EmptyState from '../../components/EmptyState';

/** Status pill styled per correction lifecycle state. */
function CorrectionStatusPill({ status }: { status: string }) {
  const cls =
    status === 'committed'
      ? 'status-pill--complete'
      : status === 'pending'
        ? 'status-pill--processing'
        : status === 'failed' || status === 'rejected'
          ? 'status-pill--failed'
          : 'status-pill--queued';
  return (
    <span className={`status-pill ${cls}`}>
      <span className="status-pill__dot" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

/**
 * CorrectionsLog — the dynamic learning loop surface.
 *
 * Two-phase flow:
 * 1. Submit a correction in plain language → recorded as `pending`
 * 2. Review + "Confirm & Apply" → written into the knowledge graph,
 *    audit node ID recorded for traceability.
 */
export default function CorrectionsLog() {
  // Handoff from a Drift Sentinel alert: correction text arrives prefilled.
  const location = useLocation();
  const handoff = (location.state ?? null) as { draft?: string; author?: string } | null;

  const [corrections, setCorrections] = useState<CorrectionEntry[]>([]);
  const [draft, setDraft] = useState(handoff?.draft ?? '');
  const [author, setAuthor] = useState(handoff?.author ?? 'Risk Officer');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCorrections(await listCorrections());
      setError(null);
    } catch (err) {
      setError(`Failed to load corrections: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSubmit = async () => {
    const text = draft.trim();
    if (!text || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await submitCorrection(text, author.trim() || 'Unknown');
      setDraft('');
      setNotice('Correction recorded as pending — review below and Confirm & Apply to commit it to the graph.');
      await refresh();
    } catch (err) {
      setError(`Submit failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirm = async (id: string) => {
    if (confirmingId) return;
    setConfirmingId(id);
    setError(null);
    setNotice(null);
    try {
      const result = await confirmCorrection(id);
      setNotice(
        `Correction applied — ${result.edges_created} edge(s) created, ` +
        `${result.edges_deprecated} deprecated. Audit node ${result.audit_node_id}. ` +
        `Deprecated edges now render amber-dashed in the Graph Explorer.`,
      );
      await refresh();
    } catch (err) {
      setError(`Apply failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConfirmingId(null);
    }
  };

  const handleReject = async (id: string) => {
    if (confirmingId) return;
    setError(null);
    setNotice(null);
    try {
      await rejectCorrection(id);
      setNotice('Correction rejected — kept in the log, graph untouched.');
      await refresh();
    } catch (err) {
      setError(`Reject failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const pendingCount = corrections.filter(c => c.status === 'pending').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', height: '100%' }}>
      {/* Submit form — phase 1 */}
      <div className="panel">
        <div className="panel__header">
          <span className="panel__title">Submit a Correction</span>
          <span className="text-mono-sm text-muted">two-phase: pending → committed</span>
        </div>
        <div className="panel__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <textarea
            className="settings-field__input"
            style={{ resize: 'vertical', minHeight: 64, fontFamily: 'inherit' }}
            placeholder='Describe what the graph got wrong — e.g. "Shandong Metals no longer supplies Guangzhou Electronics Hub; the contract moved to Nippon Chemical in May."'
            value={draft}
            onChange={e => setDraft(e.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
            <input
              className="settings-field__input"
              style={{ maxWidth: 220 }}
              placeholder="Author"
              value={author}
              onChange={e => setAuthor(e.target.value)}
            />
            <button
              className="btn btn--primary"
              onClick={handleSubmit}
              disabled={!draft.trim() || isSubmitting}
              style={{ opacity: !draft.trim() || isSubmitting ? 0.5 : 1 }}
            >
              {isSubmitting ? 'Recording…' : 'Record Correction'}
            </button>
            <span className="text-caption text-muted">
              Nothing touches the graph until you confirm it below.
            </span>
          </div>
        </div>
      </div>

      {/* Feedback strip — no silent async failures */}
      {error && (
        <div className="panel" style={{ borderColor: 'var(--signal-red)', padding: 'var(--space-md) var(--space-lg)' }}>
          <span className="text-red" style={{ fontSize: 13 }}>{error}</span>
        </div>
      )}
      {notice && (
        <div className="panel" style={{ borderColor: 'var(--signal-green)', padding: 'var(--space-md) var(--space-lg)' }}>
          <span className="text-green" style={{ fontSize: 13 }}>{notice}</span>
        </div>
      )}

      {/* Audit table — phase 2 */}
      <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="panel__header">
          <span className="panel__title">Correction History</span>
          <span className="text-mono-sm text-muted">
            {corrections.length} total · {pendingCount} pending
          </span>
        </div>
        <div className="panel__body--flush" style={{ flex: 1, overflow: 'auto' }}>
          {corrections.length === 0 ? (
            <EmptyState message="No corrections yet. When the graph gets something wrong, record it above — every change is audit-preserved, never deleted." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-hairline)' }}>
                  {['Timestamp', 'Author', 'Correction', 'Status', 'Audit Node', ''].map(h => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: 'var(--space-sm) var(--space-lg)',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corrections.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border-hairline)' }}>
                    <td className="text-mono-sm text-muted" style={{ padding: 'var(--space-sm) var(--space-lg)', whiteSpace: 'nowrap' }}>
                      {formatTimestamp(c.created_at)}
                    </td>
                    <td style={{ padding: 'var(--space-sm) var(--space-lg)', whiteSpace: 'nowrap' }}>
                      {c.author}
                    </td>
                    <td style={{ padding: 'var(--space-sm) var(--space-lg)', maxWidth: 420 }}>
                      {c.raw_text}
                    </td>
                    <td style={{ padding: 'var(--space-sm) var(--space-lg)' }}>
                      <CorrectionStatusPill status={c.status} />
                    </td>
                    <td className="text-mono-sm text-muted" style={{ padding: 'var(--space-sm) var(--space-lg)', whiteSpace: 'nowrap' }}>
                      {c.audit_node_id ? c.audit_node_id.slice(0, 8) : '—'}
                    </td>
                    <td style={{ padding: 'var(--space-sm) var(--space-lg)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {c.status === 'pending' && (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <button
                            className="btn btn--ghost"
                            style={{ padding: '4px 10px', fontSize: 12, opacity: confirmingId ? 0.5 : 1 }}
                            onClick={() => handleReject(c.id)}
                            disabled={confirmingId !== null}
                          >
                            Reject
                          </button>
                          <button
                            className="btn btn--primary"
                            style={{
                              padding: '4px 12px',
                              fontSize: 12,
                              opacity: confirmingId ? 0.5 : 1,
                            }}
                            onClick={() => handleConfirm(c.id)}
                            disabled={confirmingId !== null}
                            title="Runs LLM intent extraction + graph update — takes ~a minute on the local model"
                          >
                            {confirmingId === c.id ? 'Applying (local LLM)…' : 'Confirm & Apply'}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
