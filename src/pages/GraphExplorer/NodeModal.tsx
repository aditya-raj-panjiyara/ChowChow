import { useState, useEffect } from 'react';
import type { Entity, EntityType } from '../../types';

interface NodeModalProps {
  /** If editing an existing entity, pass it here. Null for adding new. */
  entity: Entity | null;
  onSave: (entity: Entity) => void;
  onClose: () => void;
}

const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: 'supplier', label: '🏭 Supplier' },
  { value: 'port', label: '⚓ Port' },
  { value: 'factory', label: '🔧 Factory' },
  { value: 'material', label: '📦 Material' },
  { value: 'customer', label: '👤 Customer' },
  { value: 'transit', label: '🚚 Transit' },
];

/**
 * NodeModal — Add or edit a supply chain entity node.
 * Used for both creating new nodes and editing existing ones.
 */
export default function NodeModal({ entity, onSave, onClose }: NodeModalProps) {
  const isEditing = entity !== null;

  const [name, setName] = useState(entity?.name || '');
  const [type, setType] = useState<EntityType>(entity?.type || 'supplier');
  const [region, setRegion] = useState(entity?.region || '');
  const [connectionCount, setConnectionCount] = useState(entity?.connectionCount || 0);

  // Auto-generate ID for new entities
  const [id] = useState(() => {
    if (entity) return entity.id;
    const prefix = { supplier: 'SUP', port: 'PRT', factory: 'FAC', material: 'MAT', customer: 'CUS', transit: 'TRN' };
    return `${prefix[type]}-${String(Date.now()).slice(-4)}`;
  });

  // Focus name input on mount
  useEffect(() => {
    const input = document.getElementById('node-name-input');
    input?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSave({
      id,
      name: name.trim(),
      type,
      region: region.trim() || undefined,
      connectionCount,
      hasCorrectionHistory: entity?.hasCorrectionHistory || false,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3 className="modal__title">
          {isEditing ? 'Edit Node' : 'Add New Node'}
        </h3>

        <form onSubmit={handleSubmit}>
          {/* Entity ID (read-only for existing, auto-generated for new) */}
          <div className="settings-field">
            <label className="settings-field__label">Entity ID</label>
            <input
              className="settings-field__input"
              type="text"
              value={id}
              readOnly
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                opacity: 0.7,
              }}
            />
          </div>

          {/* Name */}
          <div className="settings-field">
            <label className="settings-field__label">Name</label>
            <input
              id="node-name-input"
              className="settings-field__input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Shandong Metals Co."
            />
          </div>

          {/* Type */}
          <div className="settings-field">
            <label className="settings-field__label">Entity Type</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ENTITY_TYPES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`btn ${type === value ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setType(value)}
                  style={{ fontSize: 12, padding: '4px 12px' }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Region */}
          <div className="settings-field">
            <label className="settings-field__label">Region</label>
            <input
              className="settings-field__input"
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="e.g. CN-East, US-TN, EU"
            />
          </div>

          {/* Connection Count (for editing) */}
          {isEditing && (
            <div className="settings-field">
              <label className="settings-field__label">Connection Count</label>
              <input
                className="settings-field__input"
                type="number"
                value={connectionCount}
                onChange={(e) => setConnectionCount(parseInt(e.target.value) || 0)}
                min={0}
                style={{ fontFamily: "'JetBrains Mono', monospace", width: 100 }}
              />
            </div>
          )}

          {/* Actions */}
          <div className="modal__actions" style={{ marginTop: 'var(--space-lg)' }}>
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!name.trim()}
              style={{ opacity: name.trim() ? 1 : 0.4 }}
            >
              {isEditing ? 'Save Changes' : 'Add Node'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
