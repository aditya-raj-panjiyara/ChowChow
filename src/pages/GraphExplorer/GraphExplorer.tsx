import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import GraphCanvas, { type BlastOverlayData } from './GraphCanvas';
import { useLiveGraph, type ApplyResult, type ChangeRecord, type GraphDelta } from './useLiveGraph';
import InspectorPanel from './InspectorPanel';
import GraphSearch from './GraphSearch';
import GraphFilters from './GraphFilters';
import NodeModal from './NodeModal';
import { analyzeGraph, topCritical } from './graphAnalytics';
import {
  getGraphSnapshot,
  addCustomNode,
  deleteCustomNode,
  addCustomRelationship,
  deleteCustomRelationship,
  restoreDeletedGraph,
  simulateBlastRadius,
  type BlastRadiusResult,
} from '../../lib/tauri';
import type { Entity, EntityType, Relationship } from '../../types';
import { mapEntityType } from '../../lib/entityTypes';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const typeDotColors: Record<EntityType, string> = {
  supplier: '#5FA88A',
  port: '#5B8DBF',
  factory: '#C9A227',
  material: '#9B7FD4',
  customer: '#D4A45F',
  transit: '#4B9CA8',
};

interface Toast {
  kind: 'ok' | 'err';
  text: string;
}

/** Abstract status/event nodes — mapped onto a status chip, never a card. */
function isStatusEntity(name: string, entityType?: string | null): boolean {
  const n = name.trim().toLowerCase();
  return (
    n === 'delay' ||
    n === 'disruption' ||
    n === 'unreachable' ||
    n === 'status' ||
    n === 'warning' ||
    n === 'customs crackdown' ||
    n.endsWith(' status') ||
    (entityType ?? '').trim().toLowerCase() === 'status'
  );
}

/** Correction/metadata junk — historic memify output that is not a
 *  supply-chain entity (dates, the word "correction", correction authors). */
function isMetadataJunk(name: string): boolean {
  const n = name.trim().toLowerCase();
  return (
    n === 'correction' ||
    n === 'corrections' ||
    n === 'risk officer' ||
    n === 'drift sentinel' ||
    n === 'unnamed' ||
    /^\d{4}-\d{2}-\d{2}/.test(n) // bare dates / timestamps
  );
}

export default function GraphExplorer() {
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  // True when the BACKEND says the graph is empty — we show an honest empty
  // state, never simulated nodes (those masquerade as real data and can't
  // be deleted, which reads as the app "adding" phantom nodes).
  const [backendEmpty, setBackendEmpty] = useState(false);

  const loadGraph = useCallback(async () => {
    try {
      const snapshot = await getGraphSnapshot();
      if (snapshot.entities.length === 0) {
        setBackendEmpty(true);
        setEntities([]);
        setRelationships([]);
        return;
      }
      setBackendEmpty(false);

      // Deduplicate entities by name (case-insensitive) and build ID redirection map
      const nameToId = new Map<string, string>();
      const idRedirection = new Map<string, string>();
      const uniqueEntities: Entity[] = [];

      // Map status relationships (e.g. Port of Bangkok -> has_status -> Delay)
      const statusMap = new Map<string, string>();
      const statusNodeIds = new Set<string>();

      for (const e of snapshot.entities) {
        if (isStatusEntity(e.name, e.entity_type)) {
          statusNodeIds.add(e.id);
        }
      }

      for (const r of snapshot.relationships) {
        if (statusNodeIds.has(r.to_id)) {
          const statusNode = snapshot.entities.find(e => e.id === r.to_id);
          if (statusNode) {
            statusMap.set(r.from_id, statusNode.name);
          }
        }
      }

      for (const e of snapshot.entities) {
        if (statusNodeIds.has(e.id)) {
          continue;
        }

        // Audit records ("Correction by …") live in the graph for
        // traceability and the query-time correction overlay, but they are
        // metadata, not supply-chain entities — deliberately edge-less, so
        // they'd render as orphaned 0-link "supplier" cards. Keep them off
        // the canvas; the Corrections Log is their home. (The live-delta
        // path already skips them.) Same for correction-metadata junk that
        // historic memify runs extracted ("Correction", dates, authors).
        if (e.entity_type === 'AuditCorrection' || isMetadataJunk(e.name)) {
          continue;
        }

        const normName = e.name.trim().toLowerCase();
        if (nameToId.has(normName)) {
          const primaryId = nameToId.get(normName)!;
          idRedirection.set(e.id, primaryId);
        } else {
          nameToId.set(normName, e.id);
          idRedirection.set(e.id, e.id);
          uniqueEntities.push({
            id: e.id,
            name: e.name,
            type: mapEntityType(e.entity_type, e.name),
            connectionCount: 0,
            status: statusMap.get(e.id),
          });
        }
      }

      const mappedRels: Relationship[] = [];
      const seenRels = new Set<string>();

      for (const r of snapshot.relationships) {
        // Endpoints that were filtered off the canvas (status nodes, audit
        // records, metadata junk) have no idRedirection entry — dropping
        // their edges too, otherwise the inspector shows raw UUIDs for
        // relationships pointing at invisible nodes.
        if (!idRedirection.has(r.from_id) || !idRedirection.has(r.to_id)) continue;

        const sourceId = idRedirection.get(r.from_id) || r.from_id;
        const targetId = idRedirection.get(r.to_id) || r.to_id;

        if (sourceId === targetId) continue;

        const relKey = `${sourceId}->${targetId}:${r.relationship_type}`;
        if (seenRels.has(relKey)) continue;
        seenRels.add(relKey);

        mappedRels.push({
          id: `r-${mappedRels.length}`,
          sourceId,
          targetId,
          label: r.relationship_type,
          deprecated: !r.active,
          weight: r.weight,
        });
      }

      // Re-calculate connection counts for the unique entities
      for (const e of uniqueEntities) {
        e.connectionCount = mappedRels.filter(
          r => r.sourceId === e.id || r.targetId === e.id
        ).length;
      }

      setEntities(uniqueEntities);
      setRelationships(mappedRels);
    } catch {
      // Backend not running — keep demo data
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // ── Live graph stream ───────────────────────────────────────
  // The backend broadcasts every node/edge cognee writes (graph-delta).
  // Deltas are applied one-by-one against the current state via refs, and
  // fresh ids get a spawn animation on the canvas for a few seconds.
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const relationshipsRef = useRef(relationships);
  relationshipsRef.current = relationships;

  const [freshNodeIds, setFreshNodeIds] = useState<Set<string>>(new Set());
  const [freshEdgeIds, setFreshEdgeIds] = useState<Set<string>>(new Set());
  const freshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const markFresh = useCallback((kind: 'node' | 'edge', id: string) => {
    const setter = kind === 'node' ? setFreshNodeIds : setFreshEdgeIds;
    setter(prev => new Set(prev).add(id));
    freshTimers.current.push(setTimeout(() => {
      setter(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 6000));
  }, []);
  useEffect(() => () => freshTimers.current.forEach(clearTimeout), []);

  const applyDelta = useCallback((d: GraphDelta): ApplyResult => {
    if (d.kind === 'node_added' && d.id && d.name) {
      // Audit nodes are query overlay machinery, not supply-chain entities.
      if (d.entity_type === 'AuditCorrection') return { applied: 'other' };

      const normName = d.name.trim().toLowerCase();
      // Filter out abstract status/event nodes and correction-metadata junk.
      if (isStatusEntity(d.name, d.entity_type) || isMetadataJunk(d.name)) {
        return { applied: 'other' };
      }

      if (entitiesRef.current.some(e => e.id === d.id)) return { applied: 'other' };

      if (entitiesRef.current.some(e => e.name.trim().toLowerCase() === normName)) {
        return { applied: 'other' };
      }

      setEntities(prev => [...prev, {
        id: d.id!,
        name: d.name!,
        type: mapEntityType(d.entity_type ?? '', d.name!),
        connectionCount: 0,
      }]);
      markFresh('node', d.id);
      return { applied: 'node', label: d.name, detail: d.entity_type ?? 'Entity', nodeId: d.id };
    }

    if (d.kind === 'edge_added' && d.from_id && d.to_id && d.rel_type) {
      let sourceId = d.from_id;
      let targetId = d.to_id;

      const sourceNode = entitiesRef.current.find(e => e.id === sourceId || e.name.trim().toLowerCase() === (d.from_id || '').trim().toLowerCase());
      const targetNode = entitiesRef.current.find(e => e.id === targetId || e.name.trim().toLowerCase() === (d.to_id || '').trim().toLowerCase());

      if (sourceNode) sourceId = sourceNode.id;
      if (targetNode) targetId = targetNode.id;

      const known = new Set(entitiesRef.current.map(e => e.id));
      if (!known.has(sourceId) || !known.has(targetId)) return { applied: 'other' };
      if (sourceId === targetId) return { applied: 'other' };

      const exists = relationshipsRef.current.some(
        r => r.sourceId === sourceId && r.targetId === targetId && r.label === d.rel_type,
      );
      if (exists) return { applied: 'other' };
      const relId = `live-${d.seq}`;
      setRelationships(prev => [...prev, {
        id: relId,
        sourceId,
        targetId,
        label: d.rel_type!,
        deprecated: false,
        weight: 1,
      }]);
      setEntities(prev => prev.map(e =>
        e.id === sourceId || e.id === targetId
          ? { ...e, connectionCount: e.connectionCount + 1 }
          : e,
      ));
      markFresh('edge', relId);
      const nameOf = (id: string) => entitiesRef.current.find(e => e.id === id)?.name ?? id;
      return {
        applied: 'edge',
        label: `${nameOf(sourceId)} → ${nameOf(targetId)}`,
        detail: d.rel_type,
        fromId: sourceId,
        toId: targetId,
      };
    }

    if (d.kind === 'edge_updated' && d.from_id && d.to_id && typeof d.active === 'boolean') {
      const nowActive = d.active;
      let sourceId = d.from_id;
      let targetId = d.to_id;

      const sourceNode = entitiesRef.current.find(e => e.id === sourceId || e.name.trim().toLowerCase() === (d.from_id || '').trim().toLowerCase());
      const targetNode = entitiesRef.current.find(e => e.id === targetId || e.name.trim().toLowerCase() === (d.to_id || '').trim().toLowerCase());

      if (sourceNode) sourceId = sourceNode.id;
      if (targetNode) targetId = targetNode.id;

      // Only report a change when the flip actually changes canvas state.
      const match = relationshipsRef.current.find(r =>
        r.sourceId === sourceId && r.targetId === targetId
        && (!d.rel_type || r.label === d.rel_type) && r.deprecated === nowActive,
      );
      setRelationships(prev => prev.map(r =>
        r.sourceId === sourceId && r.targetId === targetId && (!d.rel_type || r.label === d.rel_type)
          ? { ...r, deprecated: !nowActive }
          : r,
      ));
      if (!match) return { applied: 'other' };
      if (nowActive) markFresh('edge', match.id);
      const nameOf = (id: string) => entitiesRef.current.find(e => e.id === id)?.name ?? id;
      return {
        applied: nowActive ? 'restored' : 'deprecated',
        label: `${nameOf(sourceId)} → ${nameOf(targetId)}`,
        detail: d.rel_type ?? match.label,
        fromId: sourceId,
        toId: targetId,
      };
    }

    if (d.kind === 'node_removed' && d.id) {
      setEntities(prev => prev.filter(e => e.id !== d.id));
      setRelationships(prev => prev.filter(r => r.sourceId !== d.id && r.targetId !== d.id));
      return { applied: 'other' };
    }

    return { applied: null };
  }, [markFresh]);

  const { live: liveActive, counts: liveCounts, changes: liveChanges, clearChanges } = useLiveGraph(applyDelta);
  const [showChangesDialog, setShowChangesDialog] = useState(false);
  // Auto-open the dialog the moment the first live change lands.
  useEffect(() => {
    if (liveActive && liveChanges.length > 0) setShowChangesDialog(true);
  }, [liveActive, liveChanges.length]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<EntityType[]>(['supplier', 'port', 'factory', 'material', 'customer', 'transit']);
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);

  // Feedback toast — no silent async failures.
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((kind: Toast['kind'], text: string) => {
    setToast({ kind, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  // Drag-to-connect confirmation dialog.
  const [pendingConnection, setPendingConnection] = useState<{ fromId: string; toId: string } | null>(null);
  const [pendingLabel, setPendingLabel] = useState('ships_to');

  // Focus request (Critical Dependencies → canvas re-center).
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);

  // Blast radius overlay.
  const [blastResult, setBlastResult] = useState<BlastRadiusResult | null>(null);
  const [blastDuration, setBlastDuration] = useState(14);
  const [blastRunning, setBlastRunning] = useState(false);
  const [revealedHops, setRevealedHops] = useState(0);
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showCriticalPanel, setShowCriticalPanel] = useState(true);

  // Criticality / SPOF over ACTIVE edges only — a deprecated (corrected)
  // route no longer carries dependency, so it must not inflate the badges.
  const analytics = useMemo(
    () => analyzeGraph(entities, relationships.filter(r => !r.deprecated)),
    [entities, relationships],
  );
  const criticalNodes = useMemo(() => topCritical(entities, analytics, 5), [entities, analytics]);
  const spofCount = useMemo(() => [...analytics.values()].filter(a => a.isSpof).length, [analytics]);

  const selectedEntity = useMemo(() => entities.find(e => e.id === selectedNodeId) || null, [selectedNodeId, entities]);
  const editingEntity = useMemo(
    () => (editingEntityId ? entities.find(e => e.id === editingEntityId) || null : null),
    [editingEntityId, entities],
  );

  const filteredEntities = useMemo(() => entities.filter(e => activeFilters.includes(e.type)), [entities, activeFilters]);
  const filteredRelationships = useMemo(() => {
    const entityIds = new Set(filteredEntities.map(e => e.id));
    let rels = relationships.filter(r => entityIds.has(r.sourceId) && entityIds.has(r.targetId));
    if (showDeprecated) rels = rels.filter(r => r.deprecated);
    return rels;
  }, [filteredEntities, relationships, showDeprecated]);

  // ── Blast radius ────────────────────────────────────────────
  const runBlast = useCallback(async (entityId: string, durationDays: number) => {
    setBlastRunning(true);
    try {
      const result = await simulateBlastRadius(entityId, durationDays);
      setBlastResult(result);
      setSelectedNodeId(null);
      // Ripple: reveal one hop every 600ms.
      setRevealedHops(0);
      if (revealTimer.current) clearInterval(revealTimer.current);
      let hop = 0;
      revealTimer.current = setInterval(() => {
        hop += 1;
        setRevealedHops(hop);
        if (hop >= result.max_hop && revealTimer.current) {
          clearInterval(revealTimer.current);
          revealTimer.current = null;
        }
      }, 600);
    } catch (err) {
      showToast('err', `Blast radius failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBlastRunning(false);
    }
  }, [showToast]);

  const clearBlast = useCallback(() => {
    if (revealTimer.current) clearInterval(revealTimer.current);
    revealTimer.current = null;
    setBlastResult(null);
    setRevealedHops(0);
  }, []);

  // ── Live change → canvas interactions ──────────────────────
  const [expandedChange, setExpandedChange] = useState<number | null>(null);

  // Center the canvas on the changed node and re-flash its spawn halo.
  // Deliberately does NOT open the inspector — the changes dialog stays up.
  const spotlightChange = useCallback((c: ChangeRecord) => {
    const targetId = c.kind === 'node' ? c.nodeId : c.fromId;
    if (!targetId || !entitiesRef.current.some(e => e.id === targetId)) {
      showToast('err', 'This node is no longer on the graph');
      return;
    }
    setFocusNodeId(targetId);
    setFocusNonce(v => v + 1);
    markFresh('node', targetId);
    if (c.kind !== 'node' && c.toId) markFresh('node', c.toId);
    if (c.kind === 'edge') markFresh('edge', `live-${c.seq}`);
  }, [markFresh, showToast]);

  // Relationship succession — pair a deprecated edge with the replacement
  // edge from the same correction burst (they share an endpoint), so a
  // change can be read as "PAST relation → relation that superseded it".
  const findSuccession = useCallback((c: ChangeRecord): { past: ChangeRecord | null; next: ChangeRecord | null } => {
    const shares = (a: ChangeRecord, b: ChangeRecord) =>
      !!((a.fromId && (a.fromId === b.fromId || a.fromId === b.toId)) ||
         (a.toId && (a.toId === b.fromId || a.toId === b.toId)));
    if (c.kind === 'deprecated') {
      const next = liveChanges
        .filter(r => r.kind === 'edge' && r.seq > c.seq && shares(c, r))
        .sort((x, y) => x.seq - y.seq)[0] ?? null;
      return { past: c, next };
    }
    if (c.kind === 'edge') {
      const past = liveChanges
        .filter(r => r.kind === 'deprecated' && r.seq < c.seq && shares(c, r))
        .sort((x, y) => y.seq - x.seq)[0] ?? null;
      return { past, next: c };
    }
    return { past: null, next: null };
  }, [liveChanges]);

  useEffect(() => () => {
    if (revealTimer.current) clearInterval(revealTimer.current);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const blastOverlay: BlastOverlayData | null = useMemo(() => {
    if (!blastResult) return null;
    const affected = new Map(
      blastResult.affected.map(a => [a.id, { hop: a.hop, impact: a.impact_score, severity: a.severity }]),
    );
    const pathEdges = new Set<string>();
    for (const a of blastResult.affected) {
      for (let i = 0; i < a.path_ids.length - 1; i++) {
        pathEdges.add(`${a.path_ids[i]}->${a.path_ids[i + 1]}`);
      }
    }
    return { originId: blastResult.origin_id, affected, pathEdges, revealedHops };
  }, [blastResult, revealedHops]);

  // ── CRUD handlers ───────────────────────────────────────────
  const handleAddNode = useCallback(() => {
    setModalMode('add');
    setEditingEntityId(null);
  }, []);

  const handleEditNode = useCallback((id: string) => {
    setModalMode('edit');
    setEditingEntityId(id);
  }, []);

  const handleSaveNode = useCallback(async (entity: Entity) => {
    try {
      await addCustomNode(entity.id, entity.name, entity.type);
      await loadGraph();
      showToast('ok', `Node "${entity.name}" saved`);
    } catch (err) {
      showToast('err', `Failed to save node: ${err instanceof Error ? err.message : String(err)}`);
    }
    setModalMode(null);
    setEditingEntityId(null);
  }, [loadGraph, showToast]);

  const handleDeleteNode = useCallback(async (id: string) => {
    try {
      await deleteCustomNode(id);
      setSelectedNodeId(null);
      await loadGraph();
      showToast('ok', 'Node deleted');
    } catch (err) {
      showToast('err', `Failed to delete node: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [loadGraph, showToast]);

  const handleAddRelationship = useCallback(async (fromId: string, toId: string, label: string) => {
    try {
      await addCustomRelationship(fromId, toId, label);
      await loadGraph();
      const fromName = entities.find(e => e.id === fromId)?.name ?? fromId;
      const toName = entities.find(e => e.id === toId)?.name ?? toId;
      showToast('ok', `Connected ${fromName} → ${toName} (${label})`);
    } catch (err) {
      showToast('err', `Failed to connect: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [loadGraph, entities, showToast]);

  const handleDeleteRelationship = useCallback(async (fromId: string, toId: string, label: string) => {
    try {
      await deleteCustomRelationship(fromId, toId, label);
      await loadGraph();
      showToast('ok', 'Connection removed');
    } catch (err) {
      showToast('err', `Failed to remove connection: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [loadGraph, showToast]);

  const handleRequestConnection = useCallback((fromId: string, toId: string) => {
    setPendingConnection({ fromId, toId });
    setPendingLabel('ships_to');
  }, []);

  const handleRestoreGraph = useCallback(async () => {
    try {
      const restored = await restoreDeletedGraph();
      await loadGraph();
      showToast('ok', `Restored ${restored} deleted node(s)/relationship(s) — nothing is ever hard-deleted from memory`);
    } catch (err) {
      showToast('err', `Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [loadGraph, showToast]);

  const focusOn = useCallback((id: string) => {
    setSelectedNodeId(id);
    setFocusNodeId(id);
    setFocusNonce(v => v + 1);
  }, []);

  // Deep link from reasoning-path chips: /graph?entity=<id> focuses that node.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    const entityParam = searchParams.get('entity');
    if (!entityParam || deepLinkedRef.current) return;
    if (entities.some(e => e.id === entityParam)) {
      deepLinkedRef.current = true;
      focusOn(entityParam);
      setSearchParams({}, { replace: true });
    }
  }, [entities, searchParams, focusOn, setSearchParams]);

  const criticalCount = blastResult?.affected.filter(a => a.severity === 'critical').length ?? 0;

  return (
    <div className="full-bleed">
      {/* Floating toolbar */}
      <div className="graph-search-bar">
        <GraphSearch entities={entities} onSelectEntity={focusOn} />
        <GraphFilters
          activeFilters={activeFilters}
          showDeprecated={showDeprecated}
          onToggleFilter={(type) => setActiveFilters(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])}
          onToggleDeprecated={() => setShowDeprecated(!showDeprecated)}
        />
        <button className="btn btn--primary" onClick={handleAddNode} style={{ whiteSpace: 'nowrap', fontSize: 12, padding: '6px 14px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Node
        </button>
      </div>

      {/* Canvas */}
      <GraphCanvas
        entities={filteredEntities}
        relationships={filteredRelationships}
        selectedNodeId={selectedNodeId}
        analytics={analytics}
        blast={blastOverlay}
        focusNonce={focusNonce}
        focusNodeId={focusNodeId}
        freshNodeIds={freshNodeIds}
        freshEdgeIds={freshEdgeIds}
        onSelectNode={setSelectedNodeId}
        onEditNode={handleEditNode}
        onUpdateNodePosition={() => {}}
        onRequestConnection={handleRequestConnection}
      />

      {/* Honest empty state — never phantom demo nodes */}
      {backendEmpty && entities.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
        }}>
          <div className="panel" style={{
            pointerEvents: 'auto', padding: 'var(--space-2xl)',
            textAlign: 'center', maxWidth: 440,
          }}>
            <div style={{ fontSize: 17, fontWeight: 600, fontFamily: "'Inter Tight', sans-serif", marginBottom: 8 }}>
              Knowledge graph is empty
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.7, marginBottom: 18 }}>
              Deleted nodes are tombstones, never hard-deletes — the extracted
              graph is still in memory and can be brought back in one click.
              Or ingest documents to grow it fresh.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn btn--primary" onClick={handleRestoreGraph}>
                ↺ Restore deleted nodes
              </button>
              <button className="btn btn--ghost" onClick={() => navigate('/ingestion')}>
                Go to Ingestion
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live growth badge — the knowledge graph is being written right now.
          Click to open the Live Changes dialog (also auto-opens on first change). */}
      {(liveActive || (liveChanges.length > 0 && !showChangesDialog)) && !blastResult && (
        <button
          onClick={() => setShowChangesDialog(true)}
          style={{
            position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
            background: 'var(--bg-surface)', border: `1px solid ${liveActive ? 'var(--signal-green)' : 'var(--border-hairline)'}`,
            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-panel)', zIndex: 7,
            animation: 'fade-in 0.2s ease', cursor: 'pointer',
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: liveActive ? 'var(--signal-green)' : 'var(--text-muted)',
            animation: liveActive ? 'pulse-dot 1.2s ease-in-out infinite' : undefined,
          }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: liveActive ? 'var(--signal-green)' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            {liveActive ? 'LIVE — knowledge graph growing' : 'Ingestion changes'}
          </span>
          <span className="text-mono-sm" style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            +{liveCounts.nodes} entities · +{liveCounts.edges} links · view ↗
          </span>
        </button>
      )}

      {/* Live Changes dialog — what was created, from which source, and why */}
      {showChangesDialog && !blastResult && (
        <div style={{
          position: 'absolute', top: 60, right: 16, bottom: 16, width: 380,
          background: 'var(--bg-surface)', border: `1px solid ${liveActive ? 'var(--signal-green)' : 'var(--border-hairline)'}`,
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-raised)', zIndex: 8,
          display: 'flex', flexDirection: 'column', animation: 'slide-in-right 0.2s ease',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderBottom: '1px solid var(--border-hairline)',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {liveActive && (
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--signal-green)', animation: 'pulse-dot 1.2s ease-in-out infinite' }} />
              )}
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Live Graph Changes
              </span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {liveChanges.length > 0 && (
                <button
                  onClick={clearChanges}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 10.5, cursor: 'pointer' }}
                >
                  clear
                </button>
              )}
              <button
                onClick={() => setShowChangesDialog(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer' }}
              >
                ✕
              </button>
            </span>
          </div>

          {/* Summary line */}
          <div style={{
            padding: '8px 14px', borderBottom: '1px solid var(--border-hairline)',
            fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 14,
          }}>
            <span><span className="text-mono-sm" style={{ color: 'var(--signal-green)', fontWeight: 700 }}>{liveCounts.nodes}</span> entities</span>
            <span><span className="text-mono-sm" style={{ color: 'var(--accent-cool)', fontWeight: 700 }}>{liveCounts.edges}</span> relationships</span>
            {liveCounts.deprecated > 0 && (
              <span><span className="text-mono-sm" style={{ color: 'var(--signal-amber)', fontWeight: 700 }}>{liveCounts.deprecated}</span> rewired</span>
            )}
            <span style={{ flex: 1 }} />
            <span>{liveActive ? 'streaming…' : 'complete'}</span>
          </div>

          {/* Change feed */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {liveChanges.length === 0 ? (
              <div style={{ padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.7 }}>
                Ingest a document — every entity and relationship cognee<br />
                extracts appears here as it's written, with its source<br />
                and the reason it was created.
              </div>
            ) : (
              liveChanges.map(c => {
                const expanded = expandedChange === c.seq;
                const nameOf = (id: string | null) =>
                  id ? (entities.find(e => e.id === id)?.name ?? '(removed)') : '?';
                return (
                  <div
                    key={c.seq}
                    onClick={() => {
                      setExpandedChange(prev => (prev === c.seq ? null : c.seq));
                      spotlightChange(c);
                    }}
                    style={{
                      padding: '9px 14px', borderBottom: '1px solid var(--border-hairline)',
                      borderLeft: `2px solid ${c.kind === 'node' || c.kind === 'restored' ? 'var(--signal-green)' : c.kind === 'deprecated' ? 'var(--signal-amber)' : 'var(--accent-cool)'}`,
                      cursor: 'pointer',
                      background: expanded ? 'var(--bg-raised)' : 'transparent',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = 'var(--bg-raised)'; }}
                    onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = 'transparent'; }}
                    title="Click to locate on the graph"
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                      <span className="text-mono-sm" style={{
                        fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', flexShrink: 0,
                        color: c.kind === 'node' || c.kind === 'restored' ? 'var(--signal-green)' : c.kind === 'deprecated' ? 'var(--signal-amber)' : 'var(--accent-cool)',
                      }}>
                        {c.kind === 'node' ? '＋ ENTITY' : c.kind === 'deprecated' ? '− DEPRECATED' : c.kind === 'restored' ? '↻ RESTORED' : '＋ LINK'}
                      </span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.label}
                      </span>
                      <span className="text-mono-sm" style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                        {c.detail}
                      </span>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>{expanded ? '▾' : '▸'}</span>
                    </div>
                    {c.source && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cool)" strokeWidth="2" style={{ flexShrink: 0 }}>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span className="text-mono-sm" style={{ fontSize: 10, color: 'var(--accent-cool)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.source}
                        </span>
                      </div>
                    )}
                    {c.reason && (
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5, paddingLeft: 15 }}>
                        {c.reason}
                      </div>
                    )}
                    {expanded && (() => {
                      const { past, next } = findSuccession(c);
                      return (
                        <div style={{ marginTop: 8, paddingLeft: 15, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {c.kind === 'node' ? (
                            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                              Changed node: <strong style={{ color: 'var(--text-primary)' }}>{nameOf(c.nodeId)}</strong>
                              {c.source && <> · extracted from <span style={{ color: 'var(--accent-cool)' }}>{c.source}</span></>}
                            </div>
                          ) : c.kind === 'restored' ? (
                            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                              Re-activated: <strong style={{ color: 'var(--text-primary)' }}>{nameOf(c.fromId)}</strong>
                              <span className="text-mono-sm" style={{ color: 'var(--signal-green)' }}> —{c.detail}→ </span>
                              <strong style={{ color: 'var(--text-primary)' }}>{nameOf(c.toId)}</strong>
                              {c.source && <> · from <span style={{ color: 'var(--accent-cool)' }}>{c.source}</span></>}
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 10.5, lineHeight: 1.6 }}>
                              {/* Past relation — what this change deprecated / what preceded it */}
                              {past ? (
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                  <span className="text-mono-sm" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--signal-amber)', flexShrink: 0 }}>
                                    PAST
                                  </span>
                                  <span style={{ color: 'var(--signal-amber)', textDecoration: past.seq === c.seq ? undefined : 'line-through', opacity: 0.9 }}>
                                    {nameOf(past.fromId)} —{past.detail}→ {nameOf(past.toId)}
                                  </span>
                                </div>
                              ) : (
                                <div style={{ color: 'var(--text-muted)' }}>
                                  No earlier relation was replaced — this is a brand-new link.
                                </div>
                              )}
                              {/* Successor relation — what holds now */}
                              {next ? (
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                  <span className="text-mono-sm" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--signal-green)', flexShrink: 0 }}>
                                    NOW
                                  </span>
                                  <span style={{ color: 'var(--text-primary)' }}>
                                    {nameOf(next.fromId)} <span className="text-mono-sm" style={{ color: 'var(--signal-green)' }}>—{next.detail}→</span> {nameOf(next.toId)}
                                  </span>
                                </div>
                              ) : (
                                <div style={{ color: 'var(--text-muted)' }}>
                                  No successor recorded — the relation was retired without a replacement.
                                </div>
                              )}
                              {c.source && (
                                <div style={{ color: 'var(--text-muted)' }}>
                                  Source: <span style={{ color: 'var(--accent-cool)' }}>{c.source}</span>
                                </div>
                              )}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              className="btn btn--ghost"
                              style={{ fontSize: 10.5, padding: '4px 10px' }}
                              onClick={e => { e.stopPropagation(); spotlightChange(c); }}
                            >
                              ⌖ Locate on graph
                            </button>
                            {c.kind === 'deprecated' && next && (
                              <button
                                className="btn btn--ghost"
                                style={{ fontSize: 10.5, padding: '4px 10px', color: 'var(--signal-green)' }}
                                onClick={e => { e.stopPropagation(); spotlightChange(next); }}
                              >
                                ⌖ Locate successor
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })
            )}
          </div>

          <div style={{ padding: '7px 14px', borderTop: '1px solid var(--border-hairline)', fontSize: 10, color: 'var(--text-muted)' }}>
            Click a change to locate it on the graph · rewired links show past → successor.
          </div>
        </div>
      )}

      {/* Critical Dependencies panel */}
      {!blastResult && (
        <div style={{
          position: 'absolute', top: 64, left: 16, width: 264,
          background: 'var(--bg-surface)', border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-panel)', overflow: 'hidden',
        }}>
          <button
            onClick={() => setShowCriticalPanel(v => !v)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-primary)',
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Critical Dependencies
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {spofCount > 0 && (
                <span className="text-mono-sm" style={{ color: 'var(--signal-amber)', fontSize: 10 }}>
                  {spofCount} SPOF
                </span>
              )}
              <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{showCriticalPanel ? '▾' : '▸'}</span>
            </span>
          </button>
          {showCriticalPanel && (
            <div style={{ borderTop: '1px solid var(--border-hairline)' }}>
              {criticalNodes.map((node, i) => (
                <button
                  key={node.id}
                  onClick={() => focusOn(node.id)}
                  style={{
                    width: '100%', display: 'flex', flexDirection: 'column', gap: 4,
                    padding: '9px 14px', background: 'transparent', border: 'none',
                    borderBottom: i < criticalNodes.length - 1 ? '1px solid var(--border-hairline)' : 'none',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-raised)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span className="text-mono-sm" style={{ color: 'var(--text-muted)', fontSize: 10, width: 12 }}>{i + 1}</span>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: typeDotColors[node.type], flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {node.name}
                    </span>
                    {node.isSpof && <span style={{ fontSize: 9, color: 'var(--signal-amber)' }}>⚠ SPOF</span>}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 19 }}>
                    <span style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--bg-raised)', overflow: 'hidden' }}>
                      <span style={{
                        display: 'block', height: '100%', width: `${Math.max(4, node.criticality * 100)}%`,
                        background: node.criticality > 0.66 ? 'var(--signal-amber)' : 'var(--accent-cool)',
                      }} />
                    </span>
                    <span className="text-mono-sm" style={{ fontSize: 9.5, color: 'var(--text-muted)', width: 62, textAlign: 'right' }}>
                      {node.downstreamReach} downstream
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Blast overlay summary bar */}
      {blastResult && (
        <div style={{
          position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 18, padding: '10px 18px',
          background: 'var(--bg-surface)', border: '1px solid var(--signal-amber)',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-panel)', zIndex: 6,
          animation: 'fade-in 0.25s ease',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--signal-amber)', whiteSpace: 'nowrap' }}>
            ⚡ Blast radius — {blastResult.origin_name}
          </span>
          {[
            { label: 'affected', value: String(blastResult.affected.length) },
            { label: 'critical', value: String(criticalCount), color: criticalCount > 0 ? 'var(--signal-red)' : undefined },
            { label: `exposure/${blastResult.duration_days}d`, value: usd.format(blastResult.total_exposure_usd), color: 'var(--signal-amber)' },
            { label: 'depth', value: `${Math.min(revealedHops, blastResult.max_hop)}/${blastResult.max_hop} hops` },
          ].map(stat => (
            <span key={stat.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <span className="text-mono" style={{ fontSize: 14, fontWeight: 700, color: stat.color ?? 'var(--text-primary)' }}>{stat.value}</span>
              <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{stat.label}</span>
            </span>
          ))}
          <select
            className="settings-field__select"
            style={{ width: 92, fontSize: 11, padding: '4px 22px 4px 8px' }}
            value={blastDuration}
            onChange={e => {
              const d = Number(e.target.value);
              setBlastDuration(d);
              runBlast(blastResult.origin_id, d);
            }}
          >
            {[7, 14, 30, 60].map(d => <option key={d} value={d}>{d} days</option>)}
          </select>
          <button
            className="btn btn--primary"
            style={{ fontSize: 11, padding: '5px 12px' }}
            onClick={() => navigate('/blast-radius', { state: { entityId: blastResult.origin_id, durationDays: blastDuration } })}
          >
            Full report →
          </button>
          <button
            onClick={clearBlast}
            title="Exit blast view"
            style={{
              width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Inspector */}
      {selectedEntity && !blastResult && (
        <InspectorPanel
          entity={selectedEntity}
          relationships={relationships}
          allEntities={entities}
          analytics={analytics.get(selectedEntity.id)}
          blastRunning={blastRunning}
          onClose={() => setSelectedNodeId(null)}
          onEdit={() => handleEditNode(selectedEntity.id)}
          onDelete={() => handleDeleteNode(selectedEntity.id)}
          onAddRelationship={handleAddRelationship}
          onDeleteRelationship={handleDeleteRelationship}
          onTraceBlastRadius={() => runBlast(selectedEntity.id, blastDuration)}
        />
      )}

      {/* Add/Edit node modal */}
      {modalMode && (
        <NodeModal
          entity={modalMode === 'edit' ? editingEntity : null}
          onSave={handleSaveNode}
          onClose={() => { setModalMode(null); setEditingEntityId(null); }}
        />
      )}

      {/* Drag-to-connect confirmation */}
      {pendingConnection && (
        <div className="modal-overlay" onClick={() => setPendingConnection(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__title">New connection</div>
            <p className="modal__text" style={{ marginBottom: 12 }}>
              <strong>{entities.find(e => e.id === pendingConnection.fromId)?.name}</strong>
              {' → '}
              <strong>{entities.find(e => e.id === pendingConnection.toId)?.name}</strong>
            </p>
            <label className="settings-field__label">Relationship label</label>
            <input
              className="settings-field__input"
              autoFocus
              value={pendingLabel}
              onChange={e => setPendingLabel(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && pendingLabel.trim()) {
                  handleAddRelationship(pendingConnection.fromId, pendingConnection.toId, pendingLabel.trim());
                  setPendingConnection(null);
                }
                if (e.key === 'Escape') setPendingConnection(null);
              }}
              placeholder="ships_to, supplies, fulfills…"
            />
            <div className="modal__actions" style={{ marginTop: 16 }}>
              <button className="btn btn--ghost" onClick={() => setPendingConnection(null)}>Cancel</button>
              <button
                className="btn btn--primary"
                disabled={!pendingLabel.trim()}
                style={{ opacity: pendingLabel.trim() ? 1 : 0.5 }}
                onClick={() => {
                  handleAddRelationship(pendingConnection.fromId, pendingConnection.toId, pendingLabel.trim());
                  setPendingConnection(null);
                }}
              >
                Create connection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback toast */}
      {toast && (
        <div style={{
          position: 'absolute', bottom: 56, left: '50%', transform: 'translateX(-50%)',
          padding: '9px 16px', borderRadius: 'var(--radius-md)', zIndex: 20,
          background: 'var(--bg-surface)', boxShadow: 'var(--shadow-panel)',
          border: `1px solid ${toast.kind === 'ok' ? 'var(--signal-green)' : 'var(--signal-red)'}`,
          color: toast.kind === 'ok' ? 'var(--signal-green)' : 'var(--signal-red)',
          fontSize: 12.5, animation: 'fade-in 0.2s ease', maxWidth: 520,
        }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
