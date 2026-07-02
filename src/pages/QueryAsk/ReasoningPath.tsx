import { useState } from 'react';
import type { ReasoningHop } from '../../types';
import EntityChip from '../../components/EntityChip';

interface ReasoningPathProps {
  hops: ReasoningHop[];
  hopCount: number;
}

/**
 * ReasoningPath — collapsible reasoning chain showing entity hops.
 * This is THE most important trust element: every answer shows its path.
 * Hops render as clickable entity chips that navigate to Graph Explorer.
 */
export default function ReasoningPath({ hops, hopCount }: ReasoningPathProps) {
  const [isExpanded, setIsExpanded] = useState(true); // default open per spec

  return (
    <div className="reasoning-path">
      <button
        className="reasoning-path__toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span style={{ transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>
          ▸
        </span>
        Show reasoning path ({hopCount} hops)
      </button>
      {isExpanded && (
        <div className="reasoning-path__chain">
          {hops.map((hop, i) => (
            <EntityChip
              key={hop.entityId}
              entityId={hop.entityId}
              entityName={hop.entityName}
              entityType={hop.entityType}
              showArrow={i < hops.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
