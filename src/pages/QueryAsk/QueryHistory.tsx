interface QueryHistoryProps {
  queries: string[];
  onSelect: (query: string) => void;
  onClose: () => void;
}

/**
 * QueryHistory — collapsible left drawer for past queries.
 * Hidden by default, expandable via icon. Queries are often
 * revisited during an active incident.
 */
export default function QueryHistory({ queries, onSelect, onClose }: QueryHistoryProps) {
  return (
    <div className="query-history">
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-lg)',
      }}>
        <span className="text-subheading">Query History</span>
        <button
          className="inspector-panel__close"
          onClick={onClose}
          style={{ width: 24, height: 24 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      {queries.map((query, i) => (
        <div
          key={i}
          className="query-history__item"
          onClick={() => onSelect(query)}
        >
          {query}
        </div>
      ))}
    </div>
  );
}
