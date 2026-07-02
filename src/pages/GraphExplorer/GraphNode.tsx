import { useCallback } from 'react';
import type { EntityType } from '../../types';
import type { SimulationNode } from './useForceSimulation';

interface GraphNodeProps {
  node: SimulationNode;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string, e: React.MouseEvent) => void;
  onEdit: (id: string) => void;
  /** Canvas zoom level for inverse-scaling text */
  zoom: number;
}

const entityTypeColors: Record<EntityType, { header: string; headerText: string; border: string }> = {
  supplier: {
    header: '#2D5A4A',
    headerText: '#A8E6CF',
    border: '#3A7A60',
  },
  port: {
    header: '#2A4A6B',
    headerText: '#A8D4F0',
    border: '#3A6A98',
  },
  factory: {
    header: '#4A3D32',
    headerText: '#D4C4A8',
    border: '#6A5842',
  },
  material: {
    header: '#3D2D5A',
    headerText: '#C4A8E6',
    border: '#5A3D7A',
  },
  customer: {
    header: '#5A4A2D',
    headerText: '#E6D4A8',
    border: '#7A6A3D',
  },
};

const entityTypeLabels: Record<EntityType, string> = {
  supplier: '🏭 Supplier',
  port: '⚓ Port',
  factory: '🔧 Factory',
  material: '📦 Material',
  customer: '👤 Customer',
};

/**
 * GraphNode — ComfyUI-style rectangular card node.
 * 
 * Features:
 * - Colored header bar by entity type
 * - Property rows showing key details
 * - Input port (left) and output port (right)
 * - Draggable, selectable, editable
 * - Pin indicator for manually placed nodes
 */
export default function GraphNode({ node, isSelected, onSelect, onDragStart, onEdit }: GraphNodeProps) {
  const colors = entityTypeColors[node.entity.type];
  const nodeWidth = node.width;
  const nodeHeight = node.height;
  const headerHeight = 32;
  const portRadius = 6;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.detail === 2) {
      // Double-click to edit
      onEdit(node.id);
    } else {
      onSelect(node.id);
      onDragStart(node.id, e);
    }
  }, [node.id, onSelect, onDragStart, onEdit]);

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      style={{ cursor: 'grab' }}
      onMouseDown={handleMouseDown}
    >
      {/* Selection glow */}
      {isSelected && (
        <rect
          x={-4}
          y={-4}
          width={nodeWidth + 8}
          height={nodeHeight + 8}
          rx={10}
          ry={10}
          fill="none"
          stroke="var(--accent-cool)"
          strokeWidth={2}
          opacity={0.6}
          filter="url(#glow)"
        />
      )}

      {/* Card shadow */}
      <rect
        x={2}
        y={3}
        width={nodeWidth}
        height={nodeHeight}
        rx={8}
        ry={8}
        fill="rgba(0,0,0,0.3)"
      />

      {/* Card body */}
      <rect
        x={0}
        y={0}
        width={nodeWidth}
        height={nodeHeight}
        rx={8}
        ry={8}
        fill="var(--bg-surface)"
        stroke={isSelected ? 'var(--accent-cool)' : colors.border}
        strokeWidth={isSelected ? 2 : 1}
      />

      {/* Header bar */}
      <rect
        x={0}
        y={0}
        width={nodeWidth}
        height={headerHeight}
        rx={8}
        ry={8}
        fill={colors.header}
      />
      {/* Square off the bottom corners of the header */}
      <rect
        x={0}
        y={headerHeight - 8}
        width={nodeWidth}
        height={8}
        fill={colors.header}
      />

      {/* Header text */}
      <text
        x={12}
        y={headerHeight / 2 + 1}
        dominantBaseline="middle"
        fill={colors.headerText}
        fontSize={11}
        fontFamily="'Inter Tight', sans-serif"
        fontWeight={600}
      >
        {entityTypeLabels[node.entity.type]}
      </text>

      {/* Pin indicator */}
      {node.pinned && (
        <text
          x={nodeWidth - 20}
          y={headerHeight / 2 + 1}
          dominantBaseline="middle"
          fill={colors.headerText}
          fontSize={10}
          opacity={0.7}
        >
          📌
        </text>
      )}

      {/* Entity name */}
      <text
        x={12}
        y={headerHeight + 22}
        fill="var(--text-primary)"
        fontSize={13}
        fontFamily="'Inter', sans-serif"
        fontWeight={600}
      >
        {node.entity.name.length > 22
          ? node.entity.name.substring(0, 20) + '…'
          : node.entity.name}
      </text>

      {/* Properties */}
      <text
        x={12}
        y={headerHeight + 44}
        fill="var(--text-muted)"
        fontSize={10}
        fontFamily="'JetBrains Mono', monospace"
      >
        ID: {node.entity.id}
      </text>

      {node.entity.region && (
        <text
          x={12}
          y={headerHeight + 60}
          fill="var(--text-muted)"
          fontSize={10}
          fontFamily="'JetBrains Mono', monospace"
        >
          Region: {node.entity.region}
        </text>
      )}

      <text
        x={12}
        y={headerHeight + 76}
        fill="var(--text-muted)"
        fontSize={10}
        fontFamily="'JetBrains Mono', monospace"
      >
        Connections: {node.entity.connectionCount}
      </text>

      {/* Divider line above ports area */}
      <line
        x1={0}
        y1={nodeHeight - 26}
        x2={nodeWidth}
        y2={nodeHeight - 26}
        stroke={colors.border}
        strokeWidth={0.5}
        opacity={0.5}
      />

      {/* Port labels */}
      <text
        x={portRadius + 10}
        y={nodeHeight - 11}
        fill="var(--text-muted)"
        fontSize={9}
        fontFamily="'JetBrains Mono', monospace"
      >
        IN
      </text>
      <text
        x={nodeWidth - portRadius - 24}
        y={nodeHeight - 11}
        fill="var(--text-muted)"
        fontSize={9}
        fontFamily="'JetBrains Mono', monospace"
      >
        OUT
      </text>

      {/* Input port (left side) */}
      <circle
        cx={0}
        cy={nodeHeight - 13}
        r={portRadius}
        fill="var(--bg-raised)"
        stroke={colors.border}
        strokeWidth={1.5}
      />
      <circle
        cx={0}
        cy={nodeHeight - 13}
        r={3}
        fill={colors.headerText}
        opacity={0.6}
      />

      {/* Output port (right side) */}
      <circle
        cx={nodeWidth}
        cy={nodeHeight - 13}
        r={portRadius}
        fill="var(--bg-raised)"
        stroke={colors.border}
        strokeWidth={1.5}
      />
      <circle
        cx={nodeWidth}
        cy={nodeHeight - 13}
        r={3}
        fill={colors.headerText}
        opacity={0.6}
      />

      {/* Edit hint on hover — shows via CSS */}
      <rect
        x={nodeWidth - 30}
        y={headerHeight + 6}
        width={22}
        height={18}
        rx={4}
        fill="var(--bg-raised)"
        opacity={0}
        className="node-edit-btn"
        style={{ cursor: 'pointer' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onEdit(node.id);
        }}
      />
      <text
        x={nodeWidth - 24}
        y={headerHeight + 18}
        fontSize={10}
        fill="var(--text-muted)"
        opacity={0}
        className="node-edit-icon"
        style={{ pointerEvents: 'none' }}
      >
        ✎
      </text>
    </g>
  );
}
