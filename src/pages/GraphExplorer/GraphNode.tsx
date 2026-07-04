import { useCallback } from 'react';
import type { EntityType } from '../../types';
import type { SimulationNode } from './useForceSimulation';

export interface NodeBlastState {
  role: 'origin' | 'affected';
  severity: 'critical' | 'elevated' | 'watch';
  impact: number;
  hop: number;
}

interface GraphNodeProps {
  node: SimulationNode;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string, e: React.MouseEvent) => void;
  onEdit: (id: string) => void;
  /** Canvas zoom level for inverse-scaling text */
  zoom: number;
  onStartConnection: (sourceId: string) => void;
  onMouseEnterNode: (id: string) => void;
  onMouseLeaveNode: (id: string) => void;
  /** 0..1 dependency criticality — drives card scale + load bar */
  criticality: number;
  /** Structural single point of failure — amber pulsing ring */
  isSpof: boolean;
  /** Faded out (blast overlay or hover-focus on another node) */
  dimmed: boolean;
  /** Blast overlay state for this node, if affected */
  blast: NodeBlastState | null;
  /** A connection drag is in progress from another node */
  isConnectCandidate: boolean;
  /** This node is the source of the in-progress connection drag */
  isConnectSource: boolean;
  isHovered: boolean;
  /** Just streamed in from live ingestion — spring-in + green halo */
  isNew: boolean;
}

const entityTypeColors: Record<EntityType, { header: string; headerText: string; border: string }> = {
  supplier: { header: '#2D5A4A', headerText: '#A8E6CF', border: '#3A7A60' },
  port: { header: '#2A4A6B', headerText: '#A8D4F0', border: '#3A6A98' },
  factory: { header: '#4A3D32', headerText: '#D4C4A8', border: '#6A5842' },
  material: { header: '#3D2D5A', headerText: '#C4A8E6', border: '#5A3D7A' },
  customer: { header: '#5A4A2D', headerText: '#E6D4A8', border: '#7A6A3D' },
};

const entityTypeLabels: Record<EntityType, string> = {
  supplier: '🏭 Supplier',
  port: '⚓ Port',
  factory: '🔧 Factory',
  material: '📦 Material',
  customer: '👤 Customer',
};

const severityColors = {
  critical: 'var(--signal-red)',
  elevated: 'var(--signal-amber)',
  watch: 'var(--signal-green)',
} as const;

/**
 * GraphNode — ComfyUI-style card with risk instrumentation.
 *
 * - Card size scales with dependency criticality (bigger = more depended-on)
 * - Criticality load bar + downstream count
 * - Amber pulsing ring on single points of failure
 * - Blast overlay: severity halo + impact badge, hop-staggered reveal
 * - Visible drag-to-connect handle on hover
 */
export default function GraphNode({
  node,
  isSelected,
  onSelect,
  onDragStart,
  onEdit,
  onStartConnection,
  onMouseEnterNode,
  onMouseLeaveNode,
  criticality,
  isSpof,
  dimmed,
  blast,
  isConnectCandidate,
  isConnectSource,
  isHovered,
  isNew,
}: GraphNodeProps) {
  const colors = entityTypeColors[node.entity.type];
  const nodeWidth = node.width;
  const nodeHeight = node.height;
  const headerHeight = 30;
  const portY = nodeHeight - 13;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.detail === 2) {
      onEdit(node.id);
    } else {
      onSelect(node.id);
      onDragStart(node.id, e);
    }
  }, [node.id, onSelect, onDragStart, onEdit]);

  const blastColor = blast ? severityColors[blast.severity] : null;
  const showConnectHandle = (isHovered || isConnectSource) && !blast && !dimmed;

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      style={{
        cursor: 'grab',
        opacity: dimmed ? 0.14 : 1,
        transition: 'opacity 0.35s ease',
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => onMouseEnterNode(node.id)}
      onMouseLeave={() => onMouseLeaveNode(node.id)}
    >
      <g className={isNew ? 'node-spawn' : undefined}>
      {/* Live-extraction halo — this node was just written by cognee */}
      {isNew && !blast && (
        <>
          <rect
            x={-6}
            y={-6}
            width={nodeWidth + 12}
            height={nodeHeight + 12}
            rx={11}
            fill="none"
            stroke="var(--signal-green)"
            strokeWidth={2}
          >
            <animate attributeName="opacity" values="0.95;0.3;0.95" dur="1.4s" repeatCount="indefinite" />
          </rect>
          <g transform={`translate(${nodeWidth / 2}, ${-12})`}>
            <rect x={-38} y={-10} width={76} height={17} rx={8.5} fill="rgba(95,168,138,0.18)" stroke="var(--signal-green)" strokeWidth={0.75} />
            <text x={0} y={2.5} textAnchor="middle" fontSize={8.5} fontWeight={700} letterSpacing="0.08em" fill="var(--signal-green)" fontFamily="'JetBrains Mono', monospace">
              ✦ EXTRACTED
            </text>
          </g>
        </>
      )}

      {/* Blast severity halo */}
      {blast && (
        <>
          <rect
            x={-7}
            y={-7}
            width={nodeWidth + 14}
            height={nodeHeight + 14}
            rx={12}
            fill="none"
            stroke={blastColor!}
            strokeWidth={blast.role === 'origin' ? 3 : 2}
            opacity={0.9}
          >
            {blast.role === 'origin' && (
              <animate attributeName="opacity" values="0.9;0.35;0.9" dur="1.6s" repeatCount="indefinite" />
            )}
          </rect>
          {blast.role === 'origin' && (
            <rect x={-14} y={-14} width={nodeWidth + 28} height={nodeHeight + 28} rx={16} fill="none" stroke={blastColor!} strokeWidth={1.5}>
              <animate attributeName="opacity" values="0.5;0;0.5" dur="1.6s" repeatCount="indefinite" />
            </rect>
          )}
          {/* Impact badge */}
          <g transform={`translate(${nodeWidth - 8}, -10)`}>
            <rect x={-46} y={-11} width={54} height={20} rx={10} fill={blastColor!} />
            <text x={-19} y={3} textAnchor="middle" fontSize={10} fontWeight={700} fill="#14171C" fontFamily="'JetBrains Mono', monospace">
              {blast.role === 'origin' ? 'ORIGIN' : `${Math.round(blast.impact * 100)}%`}
            </text>
          </g>
        </>
      )}

      {/* SPOF pulsing ring (suppressed inside blast overlay) */}
      {isSpof && !blast && !dimmed && (
        <>
          <rect
            x={-6}
            y={-6}
            width={nodeWidth + 12}
            height={nodeHeight + 12}
            rx={11}
            fill="none"
            stroke="var(--signal-amber)"
            strokeWidth={1.75}
            strokeDasharray="6 4"
          >
            <animate attributeName="opacity" values="0.9;0.3;0.9" dur="2.2s" repeatCount="indefinite" />
          </rect>
          <g transform={`translate(${nodeWidth / 2}, ${-12})`}>
            <rect x={-58} y={-10} width={116} height={17} rx={8.5} fill="rgba(232,162,61,0.16)" stroke="var(--signal-amber)" strokeWidth={0.75} />
            <text x={0} y={2.5} textAnchor="middle" fontSize={8.5} fontWeight={700} letterSpacing="0.08em" fill="var(--signal-amber)" fontFamily="'JetBrains Mono', monospace">
              ⚠ SINGLE POINT OF FAILURE
            </text>
          </g>
        </>
      )}

      {/* Connect-target highlight while dragging a new edge */}
      {isConnectCandidate && (
        <rect
          x={-5}
          y={-5}
          width={nodeWidth + 10}
          height={nodeHeight + 10}
          rx={10}
          fill="rgba(91,141,191,0.08)"
          stroke="var(--accent-cool)"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      )}

      {/* Selection glow */}
      {isSelected && !blast && (
        <rect
          x={-4} y={-4} width={nodeWidth + 8} height={nodeHeight + 8} rx={10}
          fill="none" stroke="var(--accent-cool)" strokeWidth={2} opacity={0.6} filter="url(#glow)"
        />
      )}

      {/* Card shadow + body */}
      <rect x={2} y={3} width={nodeWidth} height={nodeHeight} rx={8} fill="rgba(0,0,0,0.3)" />
      <rect
        x={0} y={0} width={nodeWidth} height={nodeHeight} rx={8}
        fill="var(--bg-surface)"
        stroke={isSelected ? 'var(--accent-cool)' : colors.border}
        strokeWidth={isSelected ? 2 : 1}
      />

      {/* Criticality accent — left edge, thicker + brighter = more critical */}
      <rect
        x={0}
        y={headerHeight}
        width={Math.max(2, criticality * 5)}
        height={nodeHeight - headerHeight}
        fill="var(--accent-cool)"
        opacity={0.25 + criticality * 0.75}
      />

      {/* Header */}
      <rect x={0} y={0} width={nodeWidth} height={headerHeight} rx={8} fill={colors.header} />
      <rect x={0} y={headerHeight - 8} width={nodeWidth} height={8} fill={colors.header} />
      <text x={12} y={headerHeight / 2 + 1} dominantBaseline="middle" fill={colors.headerText} fontSize={10.5} fontFamily="'Inter Tight', sans-serif" fontWeight={600}>
        {entityTypeLabels[node.entity.type]}
      </text>
      {node.pinned && (
        <text x={nodeWidth - 20} y={headerHeight / 2 + 1} dominantBaseline="middle" fill={colors.headerText} fontSize={10} opacity={0.7}>
          📌
        </text>
      )}

      {/* Name */}
      <text x={12} y={headerHeight + 21} fill="var(--text-primary)" fontSize={13} fontFamily="'Inter', sans-serif" fontWeight={600}>
        {node.entity.name.length > Math.floor(nodeWidth / 8.5)
          ? node.entity.name.substring(0, Math.floor(nodeWidth / 8.5) - 1) + '…'
          : node.entity.name}
      </text>

      {/* Dependency load bar */}
      <text x={12} y={headerHeight + 41} fill="var(--text-muted)" fontSize={9} fontFamily="'JetBrains Mono', monospace">
        DEPENDENCY
      </text>
      <rect x={80} y={headerHeight + 35} width={nodeWidth - 130} height={5} rx={2.5} fill="var(--bg-raised)" />
      <rect
        x={80}
        y={headerHeight + 35}
        width={Math.max(3, (nodeWidth - 130) * criticality)}
        height={5}
        rx={2.5}
        fill={criticality > 0.66 ? 'var(--signal-amber)' : 'var(--accent-cool)'}
      />
      <text x={nodeWidth - 12} y={headerHeight + 41} textAnchor="end" fill={criticality > 0.66 ? 'var(--signal-amber)' : 'var(--text-muted)'} fontSize={9} fontWeight={700} fontFamily="'JetBrains Mono', monospace">
        {Math.round(criticality * 100)}
      </text>

      {/* Meta row */}
      <text x={12} y={headerHeight + 58} fill="var(--text-muted)" fontSize={9.5} fontFamily="'JetBrains Mono', monospace">
        {node.entity.connectionCount} links{node.entity.region ? ` · ${node.entity.region}` : ''}
      </text>

      {/* Ports */}
      <line x1={0} y1={nodeHeight - 26} x2={nodeWidth} y2={nodeHeight - 26} stroke={colors.border} strokeWidth={0.5} opacity={0.5} />
      <text x={14} y={portY + 3} fill="var(--text-muted)" fontSize={8.5} fontFamily="'JetBrains Mono', monospace">IN</text>
      <circle cx={0} cy={portY} r={5.5} fill="var(--bg-raised)" stroke={colors.border} strokeWidth={1.5} />
      <circle cx={0} cy={portY} r={2.5} fill={colors.headerText} opacity={0.6} />

      {/* OUT port — visible connect affordance */}
      <text x={nodeWidth - 14} y={portY + 3} textAnchor="end" fill={showConnectHandle ? 'var(--accent-cool)' : 'var(--text-muted)'} fontSize={8.5} fontFamily="'JetBrains Mono', monospace">
        {showConnectHandle ? 'DRAG TO CONNECT →' : 'OUT'}
      </text>
      <circle
        cx={nodeWidth}
        cy={portY}
        r={showConnectHandle ? 8 : 5.5}
        fill={showConnectHandle ? 'var(--accent-cool)' : 'var(--bg-raised)'}
        stroke={showConnectHandle ? 'var(--accent-cool)' : colors.border}
        strokeWidth={1.5}
        style={{ transition: 'r 0.15s ease' }}
      />
      {showConnectHandle ? (
        <text x={nodeWidth} y={portY + 3.5} textAnchor="middle" fontSize={11} fontWeight={700} fill="#14171C" style={{ pointerEvents: 'none' }}>
          +
        </text>
      ) : (
        <circle cx={nodeWidth} cy={portY} r={2.5} fill={colors.headerText} opacity={0.6} />
      )}
      {/* Generous invisible hit area for starting a connection */}
      <circle
        cx={nodeWidth}
        cy={portY}
        r={18}
        fill="transparent"
        style={{ cursor: 'crosshair' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onStartConnection(node.id);
        }}
      />

      {/* Edit hint on hover */}
      <rect
        x={nodeWidth - 30} y={headerHeight + 6} width={22} height={18} rx={4}
        fill="var(--bg-raised)" opacity={0} className="node-edit-btn" style={{ cursor: 'pointer' }}
        onMouseDown={(e) => { e.stopPropagation(); onEdit(node.id); }}
      />
      <text x={nodeWidth - 24} y={headerHeight + 18} fontSize={10} fill="var(--text-muted)" opacity={0} className="node-edit-icon" style={{ pointerEvents: 'none' }}>
        ✎
      </text>
      </g>
    </g>
  );
}
