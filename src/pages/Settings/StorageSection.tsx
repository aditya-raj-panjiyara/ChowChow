interface StorageSectionProps {
  storagePath: string;
  onPathChange: (path: string) => void;
}

/**
 * StorageSection — storage path configuration.
 * Where SQLite/LanceDB/Kuzu files live, with "Open folder" button.
 */
export default function StorageSection({ storagePath, onPathChange }: StorageSectionProps) {
  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Data Storage</h3>
      <div className="settings-field">
        <label className="settings-field__label">Storage Path</label>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <input
            className="settings-field__input"
            type="text"
            value={storagePath}
            onChange={(e) => onPathChange(e.target.value)}
            style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
          />
          <button className="btn btn--ghost" style={{ whiteSpace: 'nowrap' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Open folder
          </button>
        </div>
        <p className="text-caption" style={{ marginTop: 'var(--space-sm)' }}>
          SQLite, LanceDB, and Kuzu graph databases are stored here.
        </p>
      </div>
    </div>
  );
}
