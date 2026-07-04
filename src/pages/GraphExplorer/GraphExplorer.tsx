import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import GraphCanvas, { type BlastOverlayData } from './GraphCanvas';
import { useLiveGraph, type DeltaApplied, type GraphDelta } from './useLiveGraph';
import InspectorPanel from './InspectorPanel';
import GraphSearch from './GraphSearch';
import GraphFilters from './GraphFilters';
import NodeModal from './NodeModal';
import { analyzeGraph, topCritical } from './graphAnalytics';
import { demoEntities, demoRelationships } from '../../data/demoData';
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

const ENTITY_TYPE_MAP: Record<string, EntityType> = {
  supplier: 'supplier',
  vendor: 'supplier',
  organization: 'supplier',
  company: 'supplier',
  business: 'supplier',
  distributor: 'supplier',
  port: 'port',
  location: 'port',
  place: 'port',
  city: 'port',
  depot: 'port',
  route: 'port',
  factory: 'factory',
  warehouse: 'factory',
  facility: 'factory',
  plant: 'factory',
  building: 'factory',
  material: 'material',
  product: 'material',
  item: 'material',
  goods: 'material',
  substance: 'material',
  customer: 'customer',
  person: 'customer',
  people: 'customer',
  group: 'customer',
  buyer: 'customer',
};

function mapEntityType(raw: string): EntityType {
  const key = raw.toLowerCase();
  if (ENTITY_TYPE_MAP[key]) return ENTITY_TYPE_MAP[key];
  for (const [fragment, mapped] of Object.entries(ENTITY_TYPE_MAP)) {
    if (key.includes(fragment)) return mapped;
  }
  return 'supplier';
}

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
};

interface Toast {
  kind: 'ok' | 'err';
  text: string;
}

export default function GraphExplorer() {
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Entity[]>(demoEntities);
  const [relationships, setRelationships] = useState<Relationship[]>(demoRelationships);
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
      const mapped: Entity[] = snapshot.entities.map(e => ({
        id: e.id,
        name: e.name,
        type: mapEntityType(e.entity_type),
        connectionCount: snapshot.relationships.filter(r => r.from_id === e.id || r.to_id === e.id).length,
      }));
      const mappedRels: Relationship[] = snapshot.relationships.map((r, i) => ({
        id: `r-${i}`,
        sourceId: r.from_id,
        targetId: r.to_id,
        label: r.relationship_type,
        deprecated: !r.active,
        weight: r.weight,
      }));
      setEntities(mapped);
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

  const applyDelta = useCallback((d: GraphDelta): DeltaApplied => {
    if (d.kind === 'node_added' && d.id && d.name) {
      // Audit nodes are query overlay machinery, not supply-chain entities.
      if (d.entity_type === 'AuditCorrection') return 'other';
      if (entitiesRef.current.some(e => e.id === d.id)) return 'other';
      setEntities(prev => [...prev, {
        id: d.id!,
        name: d.name!,
        type: mapEntityType(d.entity_type ?? ''),
        connectionCount: 0,
      }]);
      markFresh('node', d.id);
      return 'node';
    }

    if (d.kind === 'edge_added' && d.from_id && d.to_id && d.rel_type) {
      const known = new Set(entitiesRef.current.map(e => e.id));
      // Plumbing edges (chunk/document links) reference filtered-out nodes.
      if (!known.has(d.from_id) || !known.has(d.to_id)) return 'other';
      const exists = relationshipsRef.current.some(
        r => r.sourceId === d.from_id && r.targetId === d.to_id && r.label === d.rel_type,
      );
      if (exists) return 'other';
      const relId = `live-${d.seq}`;
      setRelationships(prev => [...prev, {
        id: relId,
        sourceId: d.from_id!,
        targetId: d.to_id!,
        label: d.rel_type!,
        deprecated: false,
        weight: 1,
      }]);
      setEntities(prev => prev.map(e =>
        e.id === d.from_id || e.id === d.to_id
          ? { ...e, connectionCount: e.connectionCount + 1 }
          : e,
      ));
      markFresh('edge', relId);
      return 'edge';
    }

    if (d.kind === 'edge_updated' && d.from_id && d.to_id && d.active === false) {
      setRelationships(prev => prev.map(r =>
        r.sourceId === d.from_id && r.targetId === d.to_id && (!d.rel_type || r.label === d.rel_type)
          ? { ...r, deprecated: true }
          : r,
      ));
      return 'other';
    }

    if (d.kind === 'node_removed' && d.id) {
      setEntities(prev => prev.filter(e => e.id !== d.id));
      setRelationships(prev => prev.filter(r => r.sourceId !== d.id && r.targetId !== d.id));
      return 'other';
    }

    return null;
  }, [markFresh]);

  const { live: liveActive, counts: liveCounts } = useLiveGraph(applyDelta);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<EntityType[]>(['supplier', 'port', 'factory', 'material', 'customer']);
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

  const analytics = useMemo(() => analyzeGraph(entities, relationships), [entities, relationships]);
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
        <GraphSearch onSelectEntity={focusOn} />
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

      {/* Live growth badge — the knowledge graph is being written right now */}
      {liveActive && !blastResult && (
        <div style={{
          position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
          background: 'var(--bg-surface)', border: '1px solid var(--signal-green)',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-panel)', zIndex: 7,
          animation: 'fade-in 0.2s ease',
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: 'var(--signal-green)',
            animation: 'pulse-dot 1.2s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--signal-green)', whiteSpace: 'nowrap' }}>
            LIVE — knowledge graph growing
          </span>
          <span className="text-mono-sm" style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            +{liveCounts.nodes} entities · +{liveCounts.edges} links
          </span>
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
