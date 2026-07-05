import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { listen } from '@tauri-apps/api/event';
import { demoTopologyNodes } from '../data/demoData';
import { getGraphSnapshot, listAlerts } from '../lib/tauri';

/**
 * TopologyStrip — persistent horizontal SVG band showing the REAL graph
 * silhouette. Dots are actual entities; arcs are actual relationships
 * (amber-dashed when deprecated); pulses mark entities with active
 * Drift Sentinel alerts. Clicking a dot deep-links to it in the Graph
 * Explorer. Falls back to the demo silhouette when the backend is empty.
 *
 * It answers "is something happening right now" without navigation.
 */

interface StripNode {
  id: string;
  name: string;
  x: number; // 0..1
  disrupted: boolean;
  alertText?: string;
}

interface StripEdge {
  fromX: number;
  toX: number;
  deprecated: boolean;
}

const MAX_DOTS = 48;
const MAX_ARCS = 70;
const POLL_MS = 8000;

function isNoise(name: string, entityType: string): boolean {
  const n = name.trim().toLowerCase();
  return (
    entityType === 'AuditCorrection' ||
    n === 'correction' ||
    n === 'corrections' ||
    n === 'risk officer' ||
    n === 'drift sentinel' ||
    n === 'unnamed' ||
    n.endsWith(' status') ||
    /^\d{4}-\d{2}-\d{2}/.test(n)
  );
}

export default function TopologyStrip() {
  const svgRef = useRef<SVGSVGElement>(null);
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<StripNode[]>([]);
  const [edges, setEdges] = useState<StripEdge[]>([]);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    // Force re-render on resize to keep strip responsive
    const handleResize = () => {
      if (svgRef.current) {
        svgRef.current.setAttribute('width', String(svgRef.current.parentElement?.clientWidth || 800));
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Live data: poll + refresh when the graph mutates (graph-delta events).
  useEffect(() => {
    let cancelled = false;
    let refreshQueued = false;

    const load = async () => {
      try {
        const [snapshot, alerts] = await Promise.all([
          getGraphSnapshot(),
          listAlerts().catch(() => []),
        ]);
        if (cancelled || snapshot.entities.length === 0) return;

        // Entities with an active alert pulse amber. Drift alerts store the
        // entity *name* in entity_id, so match on both.
        const alerted = new Map<string, string>();
        for (const a of alerts) {
          if ((a.status ?? 'active') !== 'active' || !a.entity_id) continue;
          alerted.set(a.entity_id.trim().toLowerCase(), a.description);
        }

        const connections = new Map<string, number>();
        for (const r of snapshot.relationships) {
          connections.set(r.from_id, (connections.get(r.from_id) ?? 0) + 1);
          connections.set(r.to_id, (connections.get(r.to_id) ?? 0) + 1);
        }

        const candidates = snapshot.entities
          .filter(e => !isNoise(e.name, e.entity_type))
          .map((e, idx) => {
            const alertText = alerted.get(e.name.trim().toLowerCase()) ?? alerted.get(e.id);
            return {
              id: e.id,
              name: e.name,
              idx,
              disrupted: alertText !== undefined,
              alertText,
              score: (alertText !== undefined ? 1000 : 0) + (connections.get(e.id) ?? 0),
            };
          });

        // Keep the most load-bearing dots, but preserve stable left-to-right
        // order so entities don't jump around between refreshes.
        const kept = [...candidates]
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_DOTS)
          .sort((a, b) => a.idx - b.idx);

        const span = Math.max(1, kept.length - 1);
        const xById = new Map<string, number>();
        const stripNodes: StripNode[] = kept.map((c, i) => {
          const x = 0.03 + (i / span) * 0.94;
          xById.set(c.id, x);
          return { id: c.id, name: c.name, x, disrupted: c.disrupted, alertText: c.alertText };
        });

        const stripEdges: StripEdge[] = [];
        for (const r of snapshot.relationships) {
          const fromX = xById.get(r.from_id);
          const toX = xById.get(r.to_id);
          if (fromX === undefined || toX === undefined || fromX === toX) continue;
          stripEdges.push({ fromX, toX, deprecated: !r.active });
          if (stripEdges.length >= MAX_ARCS) break;
        }

        if (!cancelled) {
          setNodes(stripNodes);
          setEdges(stripEdges);
          setIsLive(true);
        }
      } catch {
        // Backend not running — keep whatever we have (demo fallback below).
      }
    };

    load();
    const interval = setInterval(load, POLL_MS);

    // Graph mutations refresh the strip promptly (debounced to one per second).
    let unlisten: (() => void) | null = null;
    listen('graph-delta', () => {
      if (refreshQueued) return;
      refreshQueued = true;
      setTimeout(() => {
        refreshQueued = false;
        load();
      }, 1000);
    }).then(fn => {
      if (cancelled) fn();
      else unlisten = fn;
    }).catch(() => {});

    return () => {
      cancelled = true;
      clearInterval(interval);
      unlisten?.();
    };
  }, []);

  // Demo silhouette until real data arrives.
  const displayNodes: StripNode[] = useMemo(() => {
    if (isLive && nodes.length > 0) return nodes;
    return demoTopologyNodes.map(n => ({
      id: '',
      name: '',
      x: n.x,
      disrupted: n.disrupted,
    }));
  }, [isLive, nodes]);

  const height = 36;
  const cy = height / 2;

  return (
    <div className="topology-strip">
      <svg
        ref={svgRef}
        className="topology-strip__canvas"
        height={height}
        preserveAspectRatio="none"
        style={{ overflow: 'visible' }}
      >
        {/* Baseline silhouette connecting neighboring dots */}
        {displayNodes.slice(0, -1).map((node, i) => {
          const next = displayNodes[i + 1];
          const isDisruptedEdge = node.disrupted || next.disrupted;
          return (
            <line
              key={`edge-${i}`}
              x1={`${node.x * 100}%`}
              y1={cy}
              x2={`${next.x * 100}%`}
              y2={cy}
              stroke={isDisruptedEdge ? 'var(--signal-amber)' : 'var(--border-hairline)'}
              strokeWidth={isDisruptedEdge ? 1.5 : 1}
              opacity={isDisruptedEdge ? 0.6 : 0.4}
            />
          );
        })}

        {/* Real relationships as shallow arcs — amber-dashed when deprecated */}
        {isLive && edges.map((e, i) => {
          const bend = i % 2 === 0 ? -9 : 9;
          return (
            <path
              key={`arc-${i}`}
              d={`M ${e.fromX * 100}% ${cy} Q ${((e.fromX + e.toX) / 2) * 100}% ${cy + bend}, ${e.toX * 100}% ${cy}`}
              fill="none"
              stroke={e.deprecated ? 'var(--signal-amber)' : 'var(--border-hairline)'}
              strokeWidth={e.deprecated ? 1.2 : 0.6}
              strokeDasharray={e.deprecated ? '4 3' : undefined}
              opacity={e.deprecated ? 0.65 : 0.28}
            />
          );
        })}

        {/* Nodes */}
        {displayNodes.map((node, i) => (
          <g
            key={node.id || `demo-${i}`}
            style={node.id ? { cursor: 'pointer' } : undefined}
            onClick={node.id ? () => navigate(`/graph?entity=${encodeURIComponent(node.id)}`) : undefined}
          >
            {node.name && (
              <title>
                {node.name}
                {node.alertText ? ` — ⚠ ${node.alertText}` : ''}
              </title>
            )}
            {/* Pulse glow for disrupted nodes */}
            {node.disrupted && (
              <circle
                cx={`${node.x * 100}%`}
                cy={cy}
                r={8}
                fill="var(--signal-amber)"
                opacity={0.15}
                style={{ animation: 'pulse-amber 2s ease-in-out infinite' }}
              />
            )}
            {/* Generous invisible hit area for clicking */}
            {node.id && (
              <circle cx={`${node.x * 100}%`} cy={cy} r={9} fill="transparent" />
            )}
            <circle
              cx={`${node.x * 100}%`}
              cy={cy}
              r={node.disrupted ? 3.5 : 2.5}
              fill={node.disrupted ? 'var(--signal-amber)' : 'var(--text-muted)'}
              opacity={node.disrupted ? 1 : 0.5}
              style={node.disrupted ? { animation: 'pulse-amber 2s ease-in-out infinite' } : undefined}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
