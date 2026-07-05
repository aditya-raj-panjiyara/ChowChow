import { useState, useMemo } from 'react';
import type { Entity } from '../../types';

interface GraphSearchProps {
  entities: Entity[];
  onSelectEntity: (id: string) => void;
}

/**
 * GraphSearch — floating search bar with entity autocomplete.
 * Lives at the top of the graph canvas, not in a sidebar.
 */
export default function GraphSearch({ entities, onSelectEntity }: GraphSearchProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return entities.filter(
      e => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)
    ).slice(0, 6);
  }, [query, entities]);

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <input
        className="graph-search-bar__input"
        type="text"
        placeholder="Search entities..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
      />
      {isOpen && results.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: 4,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-raised)',
          overflow: 'hidden',
          zIndex: 20,
        }}>
          {results.map(entity => (
            <button
              key={entity.id}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                fontSize: 13,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'background 0.1s',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-raised)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onMouseDown={() => {
                onSelectEntity(entity.id);
                setQuery(entity.name);
                setIsOpen(false);
              }}
            >
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: `var(--entity-${entity.type})`,
                flexShrink: 0,
              }} />
              <span>{entity.name}</span>
              <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono'", fontSize: 11, color: 'var(--text-muted)' }}>
                {entity.id}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
