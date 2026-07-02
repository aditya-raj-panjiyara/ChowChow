import { useState } from 'react';
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
  onAddRelationship: (fromId: string, toId: string, label: string) => void;
  onDeleteRelationship: (fromId: string, toId: string, label: string) => void;
}

export default function InspectorPanel({
  entity,
  relationships,
  allEntities,
  onClose,
  onEdit,
  onDelete,
  onAddRelationship,
  onDeleteRelationship,
}: InspectorPanelProps) {
  const navigate = useNavigate();

  // Form states for creating connection
  const [targetId, setTargetId] = useState('');
  const [relLabel, setRelLabel] = useState('ships_to');

  // Find relationships connected to this entity
  const connectedRels = relationships.filter(
    r => r.sourceId === entity.id || r.targetId === entity.id
  );

  const getEntityName = (id: string) => {
    return allEntities.find(e => e.id === id)?.name || id;
  };

  const handleAddRelSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId || !relLabel) return;
    onAddRelationship(entity.id, targetId, relLabel);
    setTargetId('');
  };

  // Filter out the current node from potential targets
  const potentialTargets = allEntities.filter(e => e.id !== entity.id);

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
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
                  <span style={{ fontSize: 12, marginRight: 4 }}>{getEntityName(otherId)}</span>
                  
                  {/* Delete connection button */}
                  <button
                    onClick={() => onDeleteRelationship(rel.sourceId, rel.targetId, rel.label)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      padding: '2px 4px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    title="Delete connection"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--signal-red)" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Quick Add Connection Form */}
          <form onSubmit={handleAddRelSubmit} style={{
            borderTop: '1px solid var(--border-hairline)',
            paddingTop: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
              Add Connection Manually
            </div>
            
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                style={{
                  flex: 1,
                  fontSize: 11,
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  padding: '4px 6px',
                }}
                required
              >
                <option value="">Select target node...</option>
                {potentialTargets.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
                ))}
              </select>

              <input
                type="text"
                value={relLabel}
                onChange={(e) => setRelLabel(e.target.value)}
                placeholder="label (e.g. ships_to)"
                style={{
                  width: 90,
                  fontSize: 11,
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  padding: '4px 6px',
                }}
                required
              />

              <button
                type="submit"
                className="btn btn--primary"
                style={{ fontSize: 11, padding: '4px 8px' }}
              >
                +
              </button>
            </div>
          </form>
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
