import { useState } from 'react';
import type { EntityType } from '../../types';

interface GraphFiltersProps {
  activeFilters: EntityType[];
  showDeprecated: boolean;
  onToggleFilter: (type: EntityType) => void;
  onToggleDeprecated: () => void;
}

const entityTypes: { type: EntityType; label: string; color: string }[] = [
  { type: 'supplier', label: 'Suppliers', color: 'var(--entity-supplier)' },
  { type: 'port', label: 'Ports', color: 'var(--entity-port)' },
  { type: 'factory', label: 'Factories', color: 'var(--entity-factory)' },
  { type: 'material', label: 'Materials', color: 'var(--entity-material)' },
  { type: 'customer', label: 'Customers', color: 'var(--entity-customer)' },
];

/**
 * GraphFilters — filter controls for the graph canvas.
 * Filter by entity type, region, or show only deprecated paths.
 */
export default function GraphFilters({ activeFilters, showDeprecated, onToggleFilter, onToggleDeprecated }: GraphFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="graph-search-bar__filter"
        onClick={() => setIsOpen(!isOpen)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Filters
      </button>

      {isOpen && (
        <div className="filter-panel">
          <div className="filter-panel__group">
            <div className="filter-panel__group-title">Entity Types</div>
            {entityTypes.map(({ type, label, color }) => (
              <label key={type} className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={activeFilters.includes(type)}
                  onChange={() => onToggleFilter(type)}
                />
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                {label}
              </label>
            ))}
          </div>
          <div className="filter-panel__group">
            <div className="filter-panel__group-title">Edges</div>
            <label className="filter-checkbox">
              <input
                type="checkbox"
                checked={showDeprecated}
                onChange={onToggleDeprecated}
              />
              Show only deprecated paths
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
