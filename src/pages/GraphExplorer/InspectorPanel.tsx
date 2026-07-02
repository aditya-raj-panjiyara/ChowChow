import type { Entity, Relationship } from '../../types';
import { useNavigate } from 'react-router';
import MonoText from '../../components/MonoText';

interface InspectorPanelProps {
  entity: Entity;
  relationships: Relationship[];
  allEntities: Entity[];
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

/**
 * InspectorPanel — slides from right on node click (~340px wide).
 * Shows entity details, all direct relationships, audit history link,
 * and "trace blast radius from here" button — direct bridge to Blast Radius tab.
 */
export default function InspectorPanel({ entity, relationships, allEntities, onClose, onEdit, onDelete }: InspectorPanelProps) {
  const navigate = useNavigate();

  // Find relationships connected to this entity
  const connectedRels = relationships.filter(
    r => r.sourceId === entity.id || r.targetId === entity.id
  );

  const getEntityName = (id: string) => {
    return allEntities.find(e => e.id === id)?.name || id;
  };

  return (
    <div className="inspector-panel" onClick={(e) => e.stopPropagation()}>
      <div className="inspector-panel__header">
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "'Inter Tight', sans-serif" }}>
            {entity.name}
          </div>
          <MonoText muted>{entity.id}</MonoText>
        </div>
        <button className="inspector-panel__close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="inspector-panel__body">
        {/* Entity Type & Region */}
        <div className="inspector-panel__section">
          <div className="inspector-panel__section-title">Details</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span className="text-muted">Type</span>
              <span style={{ textTransform: 'capitalize' }}>{entity.type}</span>
            </div>
            {entity.region && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span className="text-muted">Region</span>
                <MonoText>{entity.region}</MonoText>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span className="text-muted">Connections</span>
              <MonoText>{entity.connectionCount}</MonoText>
            </div>
          </div>
        </div>

        {/* Relationships */}
        <div className="inspector-panel__section">
          <div className="inspector-panel__section-title">
            Relationships ({connectedRels.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {connectedRels.map(rel => {
              const otherId = rel.sourceId === entity.id ? rel.targetId : rel.sourceId;
              const direction = rel.sourceId === entity.id ? '→' : '←';
              return (
                <div
                  key={rel.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-base)',
                    opacity: rel.deprecated ? 0.5 : 1,
                  }}
                >
                  <span className="text-muted">{direction}</span>
                  <MonoText muted>{rel.label}</MonoText>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12 }}>{getEntityName(otherId)}</span>
                  {rel.deprecated && (
                    <span style={{ fontSize: 10, color: 'var(--signal-amber)', fontStyle: 'italic' }}>
                      deprecated
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="inspector-panel__section">
          {onEdit && (
            <button
              className="btn btn--ghost"
              style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}
              onClick={onEdit}
            >
              ✎ Edit Node
            </button>
          )}
          {entity.hasCorrectionHistory && (
            <button
              className="btn btn--ghost"
              style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}
              onClick={() => navigate('/corrections')}
            >
              View audit history
            </button>
          )}
          <button
            className="btn btn--primary"
            style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}
            onClick={() => navigate('/blast-radius')}
          >
            Trace blast radius from here
          </button>
          {onDelete && (
            <button
              className="btn btn--danger"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={onDelete}
            >
              Delete Node
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
