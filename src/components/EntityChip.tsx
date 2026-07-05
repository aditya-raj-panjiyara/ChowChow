import { useNavigate } from 'react-router';
import type { EntityType } from '../types';

interface EntityChipProps {
  entityId: string;
  entityName: string;
  entityType: EntityType;
  /** If true, show arrow separator (used in reasoning chains) */
  showArrow?: boolean;
}

const entityTypeColors: Record<EntityType, string> = {
  supplier: 'var(--entity-supplier)',
  port: 'var(--entity-port)',
  factory: 'var(--entity-factory)',
  material: 'var(--entity-material)',
  customer: 'var(--entity-customer)',
  transit: 'var(--entity-transit)',
};

/**
 * EntityChip — mono-labeled clickable entity reference.
 * Clicking navigates to that entity in Graph Explorer.
 */
export default function EntityChip({ entityId, entityName, entityType, showArrow }: EntityChipProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/graph?entity=${entityId}`);
  };

  return (
    <>
      <button
        className="entity-chip"
        onClick={handleClick}
        title={`${entityType}: ${entityName} (${entityId})`}
      >
        <span
          className="entity-chip__type-dot"
          style={{ background: entityTypeColors[entityType] }}
        />
        {entityName}
      </button>
      {showArrow && <span className="entity-chip__arrow">→</span>}
    </>
  );
}
