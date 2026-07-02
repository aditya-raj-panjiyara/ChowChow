import { useState } from 'react';

/**
 * ResetSection — destructive data reset with typed confirmation.
 * Requires the user to type "RESET" to confirm — protects against accidental clicks.
 */
export default function ResetSection() {
  const [showModal, setShowModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const handleReset = () => {
    if (confirmText === 'RESET') {
      // In production: clear all data
      setShowModal(false);
      setConfirmText('');
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
          Reset all data — this will permanently delete all ingested documents,
          the knowledge graph, query history, and corrections log.
        </p>
        <button className="btn btn--danger" onClick={() => setShowModal(true)}>
          Reset all data
        </button>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title" style={{ color: 'var(--signal-red)' }}>
              Confirm Data Reset
            </h3>
            <p className="modal__text">
              This action cannot be undone. All ingested data, the knowledge graph,
              query history, and corrections will be permanently deleted.
            </p>
            <div className="settings-field" style={{ marginBottom: 'var(--space-lg)' }}>
              <label className="settings-field__label">
                Type <strong style={{ fontFamily: "'JetBrains Mono'", color: 'var(--signal-red)' }}>RESET</strong> to confirm
              </label>
              <input
                className="settings-field__input"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type RESET..."
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
                autoFocus
              />
            </div>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => { setShowModal(false); setConfirmText(''); }}>
                Cancel
              </button>
              <button
                className="btn btn--danger"
                onClick={handleReset}
                disabled={confirmText !== 'RESET'}
                style={{ opacity: confirmText === 'RESET' ? 1 : 0.4 }}
              >
                Delete all data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
