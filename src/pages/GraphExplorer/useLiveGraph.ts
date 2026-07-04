import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

/**
 * One graph mutation streamed from the backend's LiveGraphDb interceptor
 * (Tauri event "graph-delta") — emitted the moment cognee writes it.
 */
export interface GraphDelta {
  seq: number;
  kind: 'node_added' | 'edge_added' | 'edge_updated' | 'node_removed';
  id: string | null;
  name: string | null;
  entity_type: string | null;
  from_id: string | null;
  to_id: string | null;
  rel_type: string | null;
  active: boolean | null;
  ts_ms: number;
}

/** What applying a delta did — drives the LIVE badge counters. */
export type DeltaApplied = 'node' | 'edge' | 'other' | null;

const DRAIN_INTERVAL_MS = 160;
const IDLE_LINGER_MS = 3000;

/**
 * Subscribes to the backend's live graph mutation stream and drains it
 * through a staggered queue (one delta per tick), so even batch writes from
 * cognify render as the graph visibly growing node-by-node.
 *
 * `applyDelta` mutates the caller's entities/relationships state and reports
 * what it did so the badge counters stay honest.
 */
export function useLiveGraph(applyDelta: (delta: GraphDelta) => DeltaApplied) {
  const [live, setLive] = useState(false);
  const [counts, setCounts] = useState({ nodes: 0, edges: 0 });

  const queueRef = useRef<GraphDelta[]>([]);
  const drainRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyRef = useRef(applyDelta);
  applyRef.current = applyDelta;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const ensureDraining = () => {
      if (drainRef.current) return;
      setLive(true);
      if (idleRef.current) {
        clearTimeout(idleRef.current);
        idleRef.current = null;
      }
      drainRef.current = setInterval(() => {
        const delta = queueRef.current.shift();
        if (!delta) {
          if (drainRef.current) clearInterval(drainRef.current);
          drainRef.current = null;
          // Keep the badge up briefly so short bursts don't flicker.
          idleRef.current = setTimeout(() => {
            setLive(false);
            setCounts({ nodes: 0, edges: 0 });
          }, IDLE_LINGER_MS);
          return;
        }
        const applied = applyRef.current(delta);
        if (applied === 'node') setCounts(c => ({ ...c, nodes: c.nodes + 1 }));
        if (applied === 'edge') setCounts(c => ({ ...c, edges: c.edges + 1 }));
      }, DRAIN_INTERVAL_MS);
    };

    listen<GraphDelta>('graph-delta', event => {
      queueRef.current.push(event.payload);
      ensureDraining();
    }).then(fn => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
      if (drainRef.current) clearInterval(drainRef.current);
      if (idleRef.current) clearTimeout(idleRef.current);
    };
  }, []);

  return { live, counts };
}
