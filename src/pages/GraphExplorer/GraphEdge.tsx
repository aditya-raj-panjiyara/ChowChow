import type { Relationship } from '../../types';
import type { SimulationNode } from './useForceSimulation';

interface GraphEdgeProps {
  relationship: Relationship;
  sourceNode: SimulationNode | undefined;
  targetNode: SimulationNode | undefined;
  /** Faded out (blast overlay / hover focus elsewhere) */
  dimmed: boolean;
  /** Part of an active blast propagation path */
  blastPath: boolean;
}

/**
 * GraphEdge — Bezier connection with direction arrowhead.
 *
 * States:
 * - normal: muted curve, slow flow dot
 * - deprecated: amber dashed (correction audit trail)
 * - blastPath: amber, thick, fast flow dots — disruption propagation
 * - dimmed: nearly invisible, keeps layout context
 */
export default function GraphEdge({ relationship, sourceNode, targetNode, dimmed, blastPath }: GraphEdgeProps) {
  if (!sourceNode || !targetNode) return null;

  const isDeprecated = relationship.deprecated;

  const sx = sourceNode.x + sourceNode.width;
  const sy = sourceNode.y + sourceNode.height - 13;
  const tx = targetNode.x;
  const ty = targetNode.y + targetNode.height - 13;

  const dx = Math.abs(tx - sx);
  const curvature = Math.max(80, dx * 0.4);
  const pathData = `M ${sx} ${sy} C ${sx + curvature} ${sy}, ${tx - curvature} ${ty}, ${tx} ${ty}`;

  const stroke = blastPath
    ? 'var(--signal-amber)'
    : isDeprecated
      ? 'var(--signal-amber)'
      : 'var(--text-muted)';
  const strokeWidth = blastPath ? 2.5 : isDeprecated ? 2 : 1.5;
  const baseOpacity = blastPath ? 0.95 : isDeprecated ? 0.5 : 0.35;

  return (
    <g style={{ opacity: dimmed ? 0.05 : 1, transition: 'opacity 0.35s ease' }}>
      {/* Hover hit area */}
      <path d={pathData} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} />
      {/* Visible path */}
      <path
        d={pathData}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={isDeprecated && !blastPath ? '8 4' : undefined}
        opacity={baseOpacity}
        markerEnd={blastPath ? 'url(#arrow-blast)' : 'url(#arrow-normal)'}
      />
      {/* Flow dots */}
      {!isDeprecated && (
        <circle r={blastPath ? 3.5 : 2.5} fill={blastPath ? 'var(--signal-amber)' : 'var(--text-muted)'} opacity={blastPath ? 1 : 0.4}>
          <animateMotion dur={blastPath ? '1s' : '3s'} repeatCount="indefinite" path={pathData} />
        </circle>
      )}
      {blastPath && (
        <circle r={2.5} fill="var(--signal-amber)" opacity={0.7}>
          <animateMotion dur="1s" begin="0.5s" repeatCount="indefinite" path={pathData} />
        </circle>
      )}
      {/* Label */}
      <text
        x={(sx + tx) / 2}
        y={(sy + ty) / 2 - 8}
        textAnchor="middle"
        fill={blastPath ? 'var(--signal-amber)' : 'var(--text-muted)'}
        fontSize={9}
        fontFamily="'JetBrains Mono', monospace"
        opacity={blastPath ? 0.9 : 0.5}
        style={{ pointerEvents: 'none' }}
      >
        {relationship.label}
      </text>
    </g>
  );
}
