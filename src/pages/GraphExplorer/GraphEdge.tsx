import type { Relationship } from '../../types';
import type { SimulationNode } from './useForceSimulation';

interface GraphEdgeProps {
  relationship: Relationship;
  sourceNode: SimulationNode | undefined;
  targetNode: SimulationNode | undefined;
}

/**
 * GraphEdge — Bezier curve connection between output→input ports.
 * ComfyUI-style: curves flow from the right (output) port of the source
 * to the left (input) port of the target, with a smooth S-curve.
 * 
 * Deprecated edges shown as amber dashed lines.
 */
export default function GraphEdge({ relationship, sourceNode, targetNode }: GraphEdgeProps) {
  if (!sourceNode || !targetNode) return null;

  const isDeprecated = relationship.deprecated;

  // Source output port position (right side of card, near bottom)
  const sx = sourceNode.x + sourceNode.width;
  const sy = sourceNode.y + sourceNode.height - 13;

  // Target input port position (left side of card, near bottom)
  const tx = targetNode.x;
  const ty = targetNode.y + targetNode.height - 13;

  // Control points for the bezier curve — horizontal S-curve like ComfyUI
  const dx = Math.abs(tx - sx);
  const curvature = Math.max(80, dx * 0.4);

  const c1x = sx + curvature;
  const c1y = sy;
  const c2x = tx - curvature;
  const c2y = ty;

  const pathData = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`;

  return (
    <g>
      {/* Wider invisible path for easier hovering */}
      <path
        d={pathData}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        style={{ cursor: 'pointer' }}
      />
      {/* Visible path */}
      <path
        d={pathData}
        fill="none"
        stroke={isDeprecated ? 'var(--signal-amber)' : 'var(--text-muted)'}
        strokeWidth={isDeprecated ? 2 : 1.5}
        strokeDasharray={isDeprecated ? '8 4' : undefined}
        opacity={isDeprecated ? 0.5 : 0.35}
      />
      {/* Animated flow dots (non-deprecated only) */}
      {!isDeprecated && (
        <circle r={2.5} fill="var(--text-muted)" opacity={0.4}>
          <animateMotion
            dur="3s"
            repeatCount="indefinite"
            path={pathData}
          />
        </circle>
      )}
      {/* Relationship label at midpoint */}
      <text
        x={(sx + tx) / 2}
        y={(sy + ty) / 2 - 8}
        textAnchor="middle"
        fill="var(--text-muted)"
        fontSize={9}
        fontFamily="'JetBrains Mono', monospace"
        opacity={0.5}
        style={{ pointerEvents: 'none' }}
      >
        {relationship.label}
      </text>
    </g>
  );
}
