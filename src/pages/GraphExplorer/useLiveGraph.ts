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
  /** Origin document/operation — e.g. "chow_shipments_erp.csv". */
  source: string | null;
  /** Why this change happened, in plain language. */
  reason: string | null;
  ts_ms: number;
}

/** What applying a delta did — drives the LIVE badge counters. */
export type DeltaApplied = 'node' | 'edge' | 'deprecated' | 'restored' | 'other' | null;

/** A committed change surfaced in the Live Changes dialog. */
export interface ChangeRecord {
  seq: number;
  kind: DeltaApplied;
  /** Human label of what was created, e.g. "Golden Tiger Warehouse" or "Chow → Kingsley". */
  label: string;
  /** Entity type (node) or relationship label (edge). */
  detail: string;
  source: string | null;
  reason: string | null;
  /** Canvas id of the created node — click-to-locate / simulate. */
  nodeId: string | null;
  /** Resolved edge endpoints on the canvas (edge changes). */
  fromId: string | null;
  toId: string | null;
  ts_ms: number;
}

const MAX_CHANGE_LOG = 200;

const DRAIN_INTERVAL_MS = 160;
const IDLE_LINGER_MS = 3000;

/** What applying a delta did, plus the resolved labels for the change log. */
export interface ApplyResult {
  applied: DeltaApplied;
  /** Node name, or "from → to" for an edge — resolved by the caller. */
  label?: string;
  detail?: string;
  /** Canvas id of the created node (node changes). */
  nodeId?: string;
  /** Resolved edge endpoint ids (edge changes) — may differ from the raw
   *  delta ids when the caller deduplicated by entity name. */
  fromId?: string;
  toId?: string;
}

/**
 * Subscribes to the backend's live graph mutation stream and drains it
 * through a staggered queue (one delta per tick), so even batch writes from
 * cognify render as the graph visibly growing node-by-node.
 *
 * `applyDelta` mutates the caller's entities/relationships state and reports
 * what it did (plus resolved labels) so the badge counters and the Live
 * Changes dialog stay honest.
 */
export function useLiveGraph(applyDelta: (delta: GraphDelta) => ApplyResult) {
  const [live, setLive] = useState(false);
  const [counts, setCounts] = useState({ nodes: 0, edges: 0, deprecated: 0 });
  const [changes, setChanges] = useState<ChangeRecord[]>([]);

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
            setCounts({ nodes: 0, edges: 0, deprecated: 0 });
            // Keep `changes` — the dialog remains reviewable after ingestion.
          }, IDLE_LINGER_MS);
          return;
        }
        const result = applyRef.current(delta);
        const { applied } = result;
        if (applied === 'node') setCounts(c => ({ ...c, nodes: c.nodes + 1 }));
        if (applied === 'edge') setCounts(c => ({ ...c, edges: c.edges + 1 }));
        if (applied === 'deprecated') setCounts(c => ({ ...c, deprecated: c.deprecated + 1 }));
        if (applied === 'node' || applied === 'edge' || applied === 'deprecated' || applied === 'restored') {
          const record: ChangeRecord = {
            seq: delta.seq,
            kind: applied,
            label: result.label ?? delta.name ?? delta.id ?? '(unknown)',
            detail: result.detail ?? delta.entity_type ?? delta.rel_type ?? '',
            source: delta.source,
            reason: delta.reason,
            nodeId: result.nodeId ?? delta.id,
            fromId: result.fromId ?? delta.from_id,
            toId: result.toId ?? delta.to_id,
            ts_ms: delta.ts_ms,
          };
          setChanges(prev => [record, ...prev].slice(0, MAX_CHANGE_LOG));
        }
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

  const clearChanges = () => setChanges([]);

  return { live, counts, changes, clearChanges };
}
