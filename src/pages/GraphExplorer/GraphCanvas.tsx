import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import type { Entity, Relationship } from '../../types';
import { useForceSimulation, type SimulationNode } from './useForceSimulation';
import type { NodeAnalytics } from './graphAnalytics';
import GraphNode, { type NodeBlastState } from './GraphNode';
import GraphEdge from './GraphEdge';

export interface BlastOverlayData {
  originId: string;
  affected: Map<string, { hop: number; impact: number; severity: 'critical' | 'elevated' | 'watch' }>;
  /** Propagation edges as `${fromId}->${toId}` */
  pathEdges: Set<string>;
  /** Hops revealed so far by the ripple animation */
  revealedHops: number;
}

interface GraphCanvasProps {
  entities: Entity[];
  relationships: Relationship[];
  selectedNodeId: string | null;
  analytics: Map<string, NodeAnalytics>;
  blast: BlastOverlayData | null;
  /** Increment to re-center the view on focusNodeId */
  focusNonce: number;
  focusNodeId: string | null;
  /** Nodes just streamed in live — spawn animation + halo */
  freshNodeIds: Set<string>;
  /** Relationships just streamed in live — highlight */
  freshEdgeIds: Set<string>;
  onSelectNode: (id: string | null) => void;
  onEditNode: (id: string) => void;
  onUpdateNodePosition: (id: string, x: number, y: number) => void;
  /** Drag-to-connect finished — open the relationship dialog */
  onRequestConnection: (fromId: string, toId: string) => void;
}

/**
 * GraphCanvas — the control-tower view of the supply network.
 *
 * - Card size + accent scale with dependency criticality
 * - Hovering a node spotlights its direct neighborhood
 * - Blast overlay ripples outward hop-by-hop with severity halos
 * - Drag from a node's OUT port to another node to create an edge
 * - Zoom / fit-view / re-layout controls
 */
export default function GraphCanvas({
  entities,
  relationships,
  selectedNodeId,
  analytics,
  blast,
  focusNonce,
  focusNodeId,
  freshNodeIds,
  freshEdgeIds,
  onSelectNode,
  onEditNode,
  onUpdateNodePosition,
  onRequestConnection,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<SimulationNode[]>([]);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [layoutNonce, setLayoutNonce] = useState(0);

  const [layoutMode, setLayoutMode] = useState<'free' | 'board'>('free');

  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null);
  const [connectionTargetPos, setConnectionTargetPos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const dragRef = useRef<{
    type: 'node' | 'pan' | null;
    nodeId: string | null;
    startX: number; startY: number;
    startNodeX: number; startNodeY: number;
    startPanX: number; startPanY: number;
    moved: boolean;
  }>({ type: null, nodeId: null, startX: 0, startY: 0, startNodeX: 0, startNodeY: 0, startPanX: 0, startPanY: 0, moved: false });

  const { initializeNodes, simulate, stop } = useForceSimulation();

  // Measure container
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth > 0 && clientHeight > 0) {
          setDimensions(prev =>
            prev.width === clientWidth && prev.height === clientHeight ? prev : { width: clientWidth, height: clientHeight },
          );
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

  // Position memory — remembers where every node has ever settled (survives
  // filter toggles), so incremental updates never reshuffle the layout.
  const positionMemoryRef = useRef(new Map<string, SimulationNode>());
  const lastLayoutNonceRef = useRef(0);
  useEffect(() => {
    for (const n of nodes) positionMemoryRef.current.set(n.id, n);
  }, [nodes]);

  // Initialize and run simulation; card size scales with criticality.
  //
  // Two modes:
  // - Bulk change (first snapshot load, manual re-layout): most nodes have no
  //   remembered position — lay the whole graph out fresh on the grid.
  // - Incremental (live growth, filter toggles): placed nodes stay put; each
  //   new node fans out around its first placed neighbor, or around the
  //   periphery of the existing cloud, and the force layout pulls it in.
  useEffect(() => {
    if (dimensions.width <= 0 || dimensions.height <= 0 || entities.length === 0) return;

    // A manual "Re-run layout" forgets all positions and starts fresh.
    if (layoutNonce !== lastLayoutNonceRef.current) {
      lastLayoutNonceRef.current = layoutNonce;
      positionMemoryRef.current.clear();
    }

    const memory = positionMemoryRef.current;
    const placedEntities = entities.filter(e => memory.has(e.id));
    const incremental = placedEntities.length >= Math.max(1, entities.length * 0.6);
    const existing = incremental ? placedEntities.map(e => memory.get(e.id)!) : undefined;

    const initialNodes = initializeNodes(entities, dimensions.width, dimensions.height, existing).map(n => {
      const crit = analytics.get(n.id)?.criticality ?? 0;
      return { ...n, width: 190 + crit * 80, height: 112 + crit * 26 };
    });

    if (incremental && existing) {
      const placedIds = new Set(existing.map(n => n.id));
      // Extents of the placed cloud — spawn fallbacks land on its rim.
      let cx = 0, cy = 0;
      for (const p of existing) { cx += p.x; cy += p.y; }
      cx /= existing.length;
      cy /= existing.length;
      let cloudR = 0;
      for (const p of existing) cloudR = Math.max(cloudR, Math.hypot(p.x - cx, p.y - cy));

      // Golden-angle fan: simultaneous arrivals spread out instead of stacking.
      let spawnIndex = 0;
      for (const n of initialNodes) {
        if (placedIds.has(n.id)) continue;
        const rel = relationships.find(r =>
          (r.sourceId === n.id && placedIds.has(r.targetId)) ||
          (r.targetId === n.id && placedIds.has(r.sourceId)),
        );
        const anchor = rel ? memory.get(rel.sourceId === n.id ? rel.targetId : rel.sourceId) : undefined;
        const angle = spawnIndex * 2.39996 + Math.random() * 0.5;
        spawnIndex += 1;
        if (anchor) {
          const r = 300 + Math.random() * 140;
          n.x = anchor.x + Math.cos(angle) * r;
          n.y = anchor.y + Math.sin(angle) * r;
        } else {
          const r = cloudR + 260 + Math.random() * 160;
          n.x = cx + Math.cos(angle) * r;
          n.y = cy + Math.sin(angle) * r;
        }
        // Remember immediately so the next delta doesn't re-seed this node.
        memory.set(n.id, n);
      }
    }
    setNodes(initialNodes);

    const cleanup = simulate(initialNodes, relationships, updated => setNodes(updated), { gentle: incremental, layoutMode });
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions.width, dimensions.height, entities.length, relationships.length, layoutNonce, layoutMode]);

  // Re-center on a requested node (Critical Dependencies / search / deep link).
  // The request may arrive before the simulation has nodes — keep it pending
  // and consume it as soon as the node exists.
  const pendingFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (focusNodeId && focusNonce > 0) pendingFocusRef.current = focusNodeId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);
  useEffect(() => {
    const wanted = pendingFocusRef.current;
    if (!wanted) return;
    const node = nodes.find(n => n.id === wanted);
    if (!node) return;
    pendingFocusRef.current = null;
    const targetZoom = 1;
    setZoom(targetZoom);
    setPan({
      x: dimensions.width / 2 - (node.x + node.width / 2) * targetZoom,
      y: dimensions.height / 2 - (node.y + node.height / 2) * targetZoom,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, nodes]);

  const fitView = useCallback(() => {
    if (nodes.length === 0 || dimensions.width === 0) return;
    const minX = Math.min(...nodes.map(n => n.x));
    const minY = Math.min(...nodes.map(n => n.y));
    const maxX = Math.max(...nodes.map(n => n.x + n.width));
    const maxY = Math.max(...nodes.map(n => n.y + n.height));
    const bboxW = maxX - minX + 120;
    const bboxH = maxY - minY + 120;
    const newZoom = Math.max(0.2, Math.min(1.5, Math.min(dimensions.width / bboxW, dimensions.height / bboxH)));
    setZoom(newZoom);
    setPan({
      x: (dimensions.width - (maxX + minX) * newZoom) / 2,
      y: (dimensions.height - (maxY + minY) * newZoom) / 2,
    });
  }, [nodes, dimensions]);

  const zoomBy = useCallback((factor: number) => {
    const newZoom = Math.max(0.2, Math.min(3, zoom * factor));
    const cx = dimensions.width / 2;
    const cy = dimensions.height / 2;
    setPan({ x: cx - (cx - pan.x) * (newZoom / zoom), y: cy - (cy - pan.y) * (newZoom / zoom) });
    setZoom(newZoom);
  }, [zoom, pan, dimensions]);

  // Direct neighbors for hover spotlight.
  const neighborsOfHovered = useMemo(() => {
    if (!hoveredNodeId) return null;
    const set = new Set<string>([hoveredNodeId]);
    for (const r of relationships) {
      if (r.sourceId === hoveredNodeId) set.add(r.targetId);
      if (r.targetId === hoveredNodeId) set.add(r.sourceId);
    }
    return set;
  }, [hoveredNodeId, relationships]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.2, Math.min(3, zoom * delta));
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      setPan({ x: mouseX - (mouseX - pan.x) * (newZoom / zoom), y: mouseY - (mouseY - pan.y) * (newZoom / zoom) });
    }
    setZoom(newZoom);
  }, [zoom, pan]);

  const handleBackgroundMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as SVGElement;
    if (target.tagName === 'svg' || target.tagName === 'rect' || target.classList.contains('canvas-bg')) {
      dragRef.current = {
        type: 'pan', nodeId: null,
        startX: e.clientX, startY: e.clientY,
        startNodeX: 0, startNodeY: 0,
        startPanX: pan.x, startPanY: pan.y,
        moved: false,
      };
      onSelectNode(null);
    }
  }, [pan, onSelectNode]);

  const handleNodeDragStart = useCallback((nodeId: string, e: React.MouseEvent) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    stop();
    dragRef.current = {
      type: 'node', nodeId,
      startX: e.clientX, startY: e.clientY,
      startNodeX: node.x, startNodeY: node.y,
      startPanX: 0, startPanY: 0,
      moved: false,
    };
  }, [nodes, stop]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (connectingSourceId) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setConnectionTargetPos({
          x: (e.clientX - rect.left - pan.x) / zoom,
          y: (e.clientY - rect.top - pan.y) / zoom,
        });
      }
      return;
    }
    const drag = dragRef.current;
    if (!drag.type) return;
    drag.moved = true;

    if (drag.type === 'pan') {
      setPan({ x: drag.startPanX + (e.clientX - drag.startX), y: drag.startPanY + (e.clientY - drag.startY) });
    } else if (drag.type === 'node' && drag.nodeId) {
      const newX = drag.startNodeX + (e.clientX - drag.startX) / zoom;
      const newY = drag.startNodeY + (e.clientY - drag.startY) / zoom;
      setNodes(prev => prev.map(n => (n.id === drag.nodeId ? { ...n, x: newX, y: newY, pinned: true } : n)));
    }
  }, [zoom, connectingSourceId, pan]);

  const handleMouseUp = useCallback(() => {
    if (connectingSourceId) {
      if (hoveredNodeId && hoveredNodeId !== connectingSourceId) {
        onRequestConnection(connectingSourceId, hoveredNodeId);
      }
      setConnectingSourceId(null);
      setConnectionTargetPos(null);
      return;
    }
    const drag = dragRef.current;
    if (drag.type === 'node' && drag.nodeId && drag.moved) {
      const node = nodes.find(n => n.id === drag.nodeId);
      if (node) onUpdateNodePosition(drag.nodeId, node.x, node.y);
    }
    dragRef.current = { type: null, nodeId: null, startX: 0, startY: 0, startNodeX: 0, startNodeY: 0, startPanX: 0, startPanY: 0, moved: false };
  }, [nodes, onUpdateNodePosition, connectingSourceId, hoveredNodeId, onRequestConnection]);

  const transform = `translate(${pan.x}, ${pan.y}) scale(${zoom})`;
  const gridSize = 40;

  // Per-node blast state resolution.
  const blastStateFor = useCallback((id: string): NodeBlastState | null => {
    if (!blast) return null;
    if (id === blast.originId) return { role: 'origin', severity: 'critical', impact: 1, hop: 0 };
    const hit = blast.affected.get(id);
    if (hit && hit.hop <= blast.revealedHops) return { role: 'affected', ...hit };
    return null;
  }, [blast]);

  const isNodeDimmed = useCallback((id: string): boolean => {
    if (blast) return blastStateFor(id) === null;
    if (neighborsOfHovered && !connectingSourceId && !dragRef.current.type) return !neighborsOfHovered.has(id);
    return false;
  }, [blast, blastStateFor, neighborsOfHovered, connectingSourceId]);

  const isEdgeOnBlastPath = useCallback((rel: Relationship): boolean => {
    if (!blast) return false;
    const onPath = blast.pathEdges.has(`${rel.sourceId}->${rel.targetId}`) || blast.pathEdges.has(`${rel.targetId}->${rel.sourceId}`);
    if (!onPath) return false;
    // Only light the segment once both endpoints are revealed.
    return blastStateFor(rel.sourceId) !== null && blastStateFor(rel.targetId) !== null;
  }, [blast, blastStateFor]);

  const isEdgeDimmed = useCallback((rel: Relationship): boolean => {
    if (blast) return !isEdgeOnBlastPath(rel);
    if (neighborsOfHovered && !connectingSourceId && !dragRef.current.type) {
      return !(rel.sourceId === hoveredNodeId || rel.targetId === hoveredNodeId);
    }
    return false;
  }, [blast, isEdgeOnBlastPath, neighborsOfHovered, hoveredNodeId, connectingSourceId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%', height: '100%', position: 'relative', overflow: 'hidden', minHeight: 400,
        cursor: connectingSourceId ? 'crosshair' : dragRef.current.type === 'pan' ? 'grabbing' : 'default',
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
            <pattern id="comfy-grid-small" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse" patternTransform={transform}>
              <path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="var(--border-hairline)" strokeWidth="0.5" opacity="0.4" />
            </pattern>
            <pattern id="comfy-grid-large" width={gridSize * 5} height={gridSize * 5} patternUnits="userSpaceOnUse" patternTransform={transform}>
              <path d={`M ${gridSize * 5} 0 L 0 0 0 ${gridSize * 5}`} fill="none" stroke="var(--border-hairline)" strokeWidth="1" opacity="0.3" />
            </pattern>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feFlood floodColor="var(--accent-cool)" floodOpacity="0.3" />
              <feComposite in2="blur" operator="in" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <marker id="arrow-normal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.5" />
            </marker>
            <marker id="arrow-blast" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="var(--signal-amber)" strokeWidth="2" />
            </marker>
          </defs>

          <rect className="canvas-bg" width="100%" height="100%" fill="var(--bg-base)" />
          <rect className="canvas-bg" width="100%" height="100%" fill="url(#comfy-grid-small)" />
          <rect className="canvas-bg" width="100%" height="100%" fill="url(#comfy-grid-large)" />

          <g transform={transform}>
            {/* Board View Lane Backgrounds & Header Cards */}
            {layoutMode === 'board' && (
              <g style={{ pointerEvents: 'none' }}>
                {(() => {
                  const columns = [
                    { type: 'material', label: '📦 Materials', color: 'var(--entity-material)' },
                    { type: 'supplier', label: '🏭 Suppliers', color: 'var(--entity-supplier)' },
                    { type: 'transit', label: '🚚 Transit', color: 'var(--entity-transit)' },
                    { type: 'port', label: '⚓ Ports', color: 'var(--entity-port)' },
                    { type: 'factory', label: '🔧 Factories', color: 'var(--entity-factory)' },
                    { type: 'customer', label: '👤 Customers', color: 'var(--entity-customer)' },
                  ];

                  return columns.map((col, idx) => {
                    const cx = idx * 450 + 200;
                    const laneWidth = 400;
                    const leftX = cx - laneWidth / 2;
                    const nodeCount = nodes.filter(n => n.entity.type === col.type).length;

                    return (
                      <g key={col.type}>
                        {/* Semi-transparent column background lane */}
                        <rect
                          x={leftX}
                          y={-2000}
                          width={laneWidth}
                          height={6000}
                          fill={col.color}
                          opacity={0.035}
                          rx={16}
                        />
                        {/* Lane divider line */}
                        {idx < 5 && (
                          <line
                            x1={cx + 225}
                            y1={-2000}
                            x2={cx + 225}
                            y2={4000}
                            stroke="var(--border-hairline)"
                            strokeWidth={1.5}
                            strokeDasharray="8 6"
                            opacity={0.3}
                          />
                        )}
                        {/* Lane Header Card */}
                        <g transform={`translate(${cx}, -60)`}>
                          <rect
                            x={-120}
                            y={-20}
                            width={240}
                            height={40}
                            rx={8}
                            fill="var(--bg-surface)"
                            stroke={col.color}
                            strokeWidth={1.5}
                            opacity={0.8}
                          />
                          <text
                            x={0}
                            y={0}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill="var(--text-primary)"
                            fontSize={13}
                            fontWeight={700}
                            fontFamily="'Inter Tight', sans-serif"
                          >
                            {col.label} <tspan fill="var(--text-muted)" fontSize={11} fontWeight={500}>({nodeCount})</tspan>
                          </text>
                        </g>
                      </g>
                    );
                  });
                })()}
              </g>
            )}

            <g>
              {relationships.map(rel => (
                <GraphEdge
                  key={rel.id}
                  relationship={rel}
                  sourceNode={nodes.find(n => n.id === rel.sourceId)}
                  targetNode={nodes.find(n => n.id === rel.targetId)}
                  dimmed={isEdgeDimmed(rel)}
                  blastPath={isEdgeOnBlastPath(rel)}
                  isNew={freshEdgeIds.has(rel.id)}
                />
              ))}
            </g>

            {/* Drag-to-connect preview line */}
            {connectingSourceId && connectionTargetPos && (() => {
              const srcNode = nodes.find(n => n.id === connectingSourceId);
              if (!srcNode) return null;
              const p0 = { x: srcNode.x + srcNode.width, y: srcNode.y + srcNode.height - 13 };
              const p1 = connectionTargetPos;
              const pathData = `M ${p0.x} ${p0.y} C ${p0.x + 60} ${p0.y}, ${p1.x - 60} ${p1.y}, ${p1.x} ${p1.y}`;
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <path d={pathData} fill="none" stroke="var(--accent-cool)" strokeWidth={2.5} strokeDasharray="6 5" opacity={0.9} />
                  <circle cx={p1.x} cy={p1.y} r={5} fill="var(--accent-cool)" />
                </g>
              );
            })()}

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
                  onMouseLeaveNode={(id) => setHoveredNodeId(prev => (prev === id ? null : prev))}
                  criticality={analytics.get(node.id)?.criticality ?? 0}
                  isSpof={analytics.get(node.id)?.isSpof ?? false}
                  dimmed={isNodeDimmed(node.id)}
                  blast={blastStateFor(node.id)}
                  isConnectCandidate={!!connectingSourceId && hoveredNodeId === node.id && node.id !== connectingSourceId}
                  isConnectSource={connectingSourceId === node.id}
                  isHovered={hoveredNodeId === node.id}
                  isNew={freshNodeIds.has(node.id)}
                />
              ))}
            </g>
          </g>

          <text x={dimensions.width - 16} y={dimensions.height - 16} textAnchor="end" fill="var(--text-muted)" fontSize={11} fontFamily="'JetBrains Mono', monospace" opacity={0.5}>
            {Math.round(zoom * 100)}%
          </text>
        </svg>
      )}

      {/* Canvas controls */}
      <div style={{
        position: 'absolute', top: 64, right: 16,
        display: 'flex', flexDirection: 'column', gap: 4,
        background: 'var(--bg-surface)', border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)', padding: 4, boxShadow: 'var(--shadow-panel)',
      }}>
        {[
          { label: '+', title: 'Zoom in', action: () => zoomBy(1.25) },
          { label: '−', title: 'Zoom out', action: () => zoomBy(0.8) },
          { label: '⛶', title: 'Fit to view', action: fitView },
          {
            label: layoutMode === 'board' ? '⚛' : '◫',
            title: layoutMode === 'board' ? 'Switch to network view' : 'Switch to board column view',
            action: () => {
              positionMemoryRef.current.clear();
              setLayoutMode(prev => prev === 'free' ? 'board' : 'free');
            }
          },
          { label: '↺', title: 'Re-run layout', action: () => setLayoutNonce(v => v + 1) },
        ].map(btn => (
          <button
            key={btn.title}
            title={btn.title}
            onClick={btn.action}
            style={{
              width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-raised)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 16, left: 16,
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px',
        background: 'var(--bg-surface)', border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)', fontSize: 11, color: 'var(--text-muted)', boxShadow: 'var(--shadow-panel)',
      }}>
        {[
          { label: 'Supplier', color: '#2D5A4A' },
          { label: 'Port', color: '#2A4A6B' },
          { label: 'Factory', color: '#4A3D32' },
          { label: 'Material', color: '#3D2D5A' },
          { label: 'Customer', color: '#5A4A2D' },
        ].map(item => (
          <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 8, borderRadius: 2, background: item.color, border: '1px solid rgba(255,255,255,0.1)' }} />
            {item.label}
          </span>
        ))}
        <span style={{ width: 1, height: 14, background: 'var(--border-hairline)' }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 20, height: 8, borderRadius: 2, border: '1.5px dashed var(--signal-amber)' }} />
          Single point of failure
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 12 }}>▮▯</span>
          Bigger card = more depended on
        </span>
      </div>

      {/* Controls hint */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16, padding: '6px 12px',
        background: 'var(--bg-surface)', border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)', fontSize: 10, color: 'var(--text-muted)',
        boxShadow: 'var(--shadow-panel)', display: 'flex', gap: 12,
      }}>
        <span>Scroll: Zoom</span>
        <span>Drag bg: Pan</span>
        <span>Hover node: Spotlight</span>
        <span>Drag OUT port: Connect</span>
      </div>
    </div>
  );
}
