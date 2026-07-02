import { useEffect, useState, useRef, useCallback } from 'react';
import type { Entity, Relationship } from '../../types';
import { useForceSimulation, type SimulationNode } from './useForceSimulation';
import GraphNode from './GraphNode';
import GraphEdge from './GraphEdge';

interface GraphCanvasProps {
  entities: Entity[];
  relationships: Relationship[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onEditNode: (id: string) => void;
  onUpdateNodePosition: (id: string, x: number, y: number) => void;
  onAddRelationship: (fromId: string, toId: string, label: string) => void;
}

/**
 * GraphCanvas — ComfyUI-style interactive canvas.
 * 
 * Features:
 * - Pan: click & drag on background
 * - Zoom: mouse wheel
 * - Drag nodes: click & drag on node cards
 * - Grid background scales with zoom
 * - Bezier curve connections between ports
 */
export default function GraphCanvas({
  entities,
  relationships,
  selectedNodeId,
  onSelectNode,
  onEditNode,
  onUpdateNodePosition,
  onAddRelationship,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<SimulationNode[]>([]);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Pan & Zoom state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  // Connection state
  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null);
  const [connectionTargetPos, setConnectionTargetPos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Drag state
  const dragRef = useRef<{
    type: 'node' | 'pan' | null;
    nodeId: string | null;
    startX: number;
    startY: number;
    startNodeX: number;
    startNodeY: number;
    startPanX: number;
    startPanY: number;
  }>({ type: null, nodeId: null, startX: 0, startY: 0, startNodeX: 0, startNodeY: 0, startPanX: 0, startPanY: 0 });

  const { initializeNodes, simulate, stop } = useForceSimulation();

  // Measure container
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth > 0 && clientHeight > 0) {
          setDimensions(prev => {
            if (prev.width === clientWidth && prev.height === clientHeight) return prev;
            return { width: clientWidth, height: clientHeight };
          });
        }
      }
    };
    const rafId = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Initialize and run simulation
  useEffect(() => {
    if (dimensions.width <= 0 || dimensions.height <= 0 || entities.length === 0) return;

    const initialNodes = initializeNodes(entities, dimensions.width, dimensions.height);
    setNodes(initialNodes);

    const cleanup = simulate(initialNodes, relationships, (updatedNodes) => {
      setNodes(updatedNodes);
    });

    return () => {
      cleanup();
    };
    // We only want to re-run when the actual entity/relationship data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions.width, dimensions.height, entities.length, relationships.length]);

  // === Mouse wheel zoom ===
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.2, Math.min(3, zoom * delta));

    // Zoom toward cursor position
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom);
      const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom);
      setPan({ x: newPanX, y: newPanY });
    }
    setZoom(newZoom);
  }, [zoom, pan]);

  // === Background pan ===
  const handleBackgroundMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // left click only
    const target = e.target as SVGElement;
    // Only pan if clicking on background (SVG, rect, or pattern)
    if (target.tagName === 'svg' || target.tagName === 'rect' || target.classList.contains('canvas-bg')) {
      dragRef.current = {
        type: 'pan',
        nodeId: null,
        startX: e.clientX,
        startY: e.clientY,
        startNodeX: 0,
        startNodeY: 0,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      onSelectNode(null);
    }
  }, [pan, onSelectNode]);

  // === Node drag start ===
  const handleNodeDragStart = useCallback((nodeId: string, e: React.MouseEvent) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    stop(); // Stop simulation when dragging

    dragRef.current = {
      type: 'node',
      nodeId,
      startX: e.clientX,
      startY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
      startPanX: 0,
      startPanY: 0,
    };
  }, [nodes, stop]);

  // === Mouse move (handles both pan and node drag) ===
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (connectingSourceId) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const x = (e.clientX - rect.left - pan.x) / zoom;
        const y = (e.clientY - rect.top - pan.y) / zoom;
        setConnectionTargetPos({ x, y });
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag.type) return;

    if (drag.type === 'pan') {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      setPan({ x: drag.startPanX + dx, y: drag.startPanY + dy });
    } else if (drag.type === 'node' && drag.nodeId) {
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      const newX = drag.startNodeX + dx;
      const newY = drag.startNodeY + dy;

      setNodes(prev => prev.map(n =>
        n.id === drag.nodeId
          ? { ...n, x: newX, y: newY, pinned: true }
          : n
      ));
    }
  }, [zoom, connectingSourceId, pan]);

  // === Mouse up ===
  const handleMouseUp = useCallback(() => {
    if (connectingSourceId) {
      if (hoveredNodeId && hoveredNodeId !== connectingSourceId) {
        onAddRelationship(connectingSourceId, hoveredNodeId, 'relies_on');
      }
      setConnectingSourceId(null);
      setConnectionTargetPos(null);
      return;
    }

    const drag = dragRef.current;
    if (drag.type === 'node' && drag.nodeId) {
      const node = nodes.find(n => n.id === drag.nodeId);
      if (node) {
        onUpdateNodePosition(drag.nodeId, node.x, node.y);
      }
    }
    dragRef.current = { type: null, nodeId: null, startX: 0, startY: 0, startNodeX: 0, startNodeY: 0, startPanX: 0, startPanY: 0 };
  }, [nodes, onUpdateNodePosition, connectingSourceId, hoveredNodeId, onAddRelationship]);

  // Canvas transform string
  const transform = `translate(${pan.x}, ${pan.y}) scale(${zoom})`;

  // Grid pattern size scales inversely with zoom for consistent visual
  const gridSize = 40;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        minHeight: 400,
        cursor: dragRef.current.type === 'pan' ? 'grabbing' : 'default',
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {dimensions.width > 0 && dimensions.height > 0 && (
        <svg
          width={dimensions.width}
          height={dimensions.height}
          onMouseDown={handleBackgroundMouseDown}
          onWheel={handleWheel}
          style={{ display: 'block', userSelect: 'none' }}
        >
          <defs>
            {/* Grid pattern */}
            <pattern
              id="comfy-grid-small"
              width={gridSize}
              height={gridSize}
              patternUnits="userSpaceOnUse"
              patternTransform={transform}
            >
              <path
                d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
                fill="none"
                stroke="var(--border-hairline)"
                strokeWidth="0.5"
                opacity="0.4"
              />
            </pattern>
            <pattern
              id="comfy-grid-large"
              width={gridSize * 5}
              height={gridSize * 5}
              patternUnits="userSpaceOnUse"
              patternTransform={transform}
            >
              <path
                d={`M ${gridSize * 5} 0 L 0 0 0 ${gridSize * 5}`}
                fill="none"
                stroke="var(--border-hairline)"
                strokeWidth="1"
                opacity="0.3"
              />
            </pattern>

            {/* Glow filter for selected nodes */}
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feFlood floodColor="var(--accent-cool)" floodOpacity="0.3" />
              <feComposite in2="blur" operator="in" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background */}
          <rect
            className="canvas-bg"
            width="100%"
            height="100%"
            fill="var(--bg-base)"
          />
          <rect className="canvas-bg" width="100%" height="100%" fill="url(#comfy-grid-small)" />
          <rect className="canvas-bg" width="100%" height="100%" fill="url(#comfy-grid-large)" />

          {/* Transformed content group */}
          <g transform={transform}>
            {/* Edges (rendered below nodes) */}
            <g>
              {relationships.map(rel => (
                <GraphEdge
                  key={rel.id}
                  relationship={rel}
                  sourceNode={nodes.find(n => n.id === rel.sourceId)}
                  targetNode={nodes.find(n => n.id === rel.targetId)}
                />
              ))}
            </g>

            {/* Temporary drag-to-connect line */}
            {connectingSourceId && connectionTargetPos && (() => {
              const srcNode = nodes.find(n => n.id === connectingSourceId);
              if (!srcNode) return null;
              const p0 = { x: srcNode.x + srcNode.width, y: srcNode.y + srcNode.height - 13 };
              const p1 = connectionTargetPos;
              const cp1x = p0.x + 50;
              const cp1y = p0.y;
              const cp2x = p1.x - 50;
              const cp2y = p1.y;
              const pathData = `M ${p0.x} ${p0.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <path
                    d={pathData}
                    fill="none"
                    stroke="var(--accent-cool)"
                    strokeWidth={2}
                    strokeDasharray="5,5"
                    opacity={0.8}
                  />
                  <circle cx={p1.x} cy={p1.y} r={4} fill="var(--accent-cool)" />
                </g>
              );
            })()}

            {/* Nodes */}
            <g>
              {nodes.map(node => (
                <GraphNode
                  key={node.id}
                  node={node}
                  isSelected={selectedNodeId === node.id}
                  onSelect={onSelectNode}
                  onDragStart={handleNodeDragStart}
                  onEdit={onEditNode}
                  zoom={zoom}
                  onStartConnection={setConnectingSourceId}
                  onMouseEnterNode={setHoveredNodeId}
                  onMouseLeaveNode={(id) => setHoveredNodeId(prev => prev === id ? null : prev)}
                />
              ))}
            </g>
          </g>

          {/* Zoom indicator */}
          <text
            x={dimensions.width - 16}
            y={dimensions.height - 16}
            textAnchor="end"
            fill="var(--text-muted)"
            fontSize={11}
            fontFamily="'JetBrains Mono', monospace"
            opacity={0.5}
          >
            {Math.round(zoom * 100)}%
          </text>
        </svg>
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        display: 'flex',
        gap: 12,
        padding: '8px 14px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        fontSize: 11,
        color: 'var(--text-muted)',
        boxShadow: 'var(--shadow-panel)',
      }}>
        {[
          { label: 'Supplier', color: '#2D5A4A' },
          { label: 'Port', color: '#2A4A6B' },
          { label: 'Factory', color: '#4A3D32' },
          { label: 'Material', color: '#3D2D5A' },
          { label: 'Customer', color: '#5A4A2D' },
        ].map(item => (
          <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              width: 12, height: 8, borderRadius: 2,
              background: item.color, border: '1px solid rgba(255,255,255,0.1)'
            }} />
            {item.label}
          </span>
        ))}
      </div>

      {/* Controls hint */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        padding: '6px 12px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        fontSize: 10,
        color: 'var(--text-muted)',
        boxShadow: 'var(--shadow-panel)',
        display: 'flex',
        gap: 12,
      }}>
        <span>Scroll: Zoom</span>
        <span>Drag bg: Pan</span>
        <span>Drag node: Move</span>
        <span>Dbl-click: Edit</span>
      </div>
    </div>
  );
}
