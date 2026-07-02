import { useState, useMemo, useCallback, useEffect } from 'react';
import GraphCanvas from './GraphCanvas';
import InspectorPanel from './InspectorPanel';
import GraphSearch from './GraphSearch';
import GraphFilters from './GraphFilters';
import NodeModal from './NodeModal';
import { demoEntities, demoRelationships } from '../../data/demoData';
import { getGraphSnapshot } from '../../lib/tauri';
import type { Entity, EntityType, Relationship } from '../../types';

// Maps both the app's domain types and cognee's semantic types
// ("Person", "Location", "Product", "Organization"…) onto the fixed
// five-color palette.
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
  // Substring match handles compound labels like "Criminal Organization".
  for (const [fragment, mapped] of Object.entries(ENTITY_TYPE_MAP)) {
    if (key.includes(fragment)) return mapped;
  }
  return 'supplier';
}

/**
 * GraphExplorer page — ComfyUI-style visual knowledge graph.
 * Full-bleed interactive canvas with:
 * - Drag to move nodes
 * - Pan & zoom canvas
 * - Add/edit/delete nodes
 * - Search and filter
 * - Inspector panel on selection
 */
export default function GraphExplorer() {
  // Data state (mutable — supports add/edit/delete)
  const [entities, setEntities] = useState<Entity[]>(demoEntities);
  const [relationships, setRelationships] = useState<Relationship[]>(demoRelationships);

  useEffect(() => {
    getGraphSnapshot().then(snapshot => {
      if (snapshot.entities.length === 0) return; // keep demo data when graph is empty
      const mapped: Entity[] = snapshot.entities.map(e => ({
        id: e.id,
        name: e.name,
        type: mapEntityType(e.entity_type),
        connectionCount: snapshot.relationships.filter(
          r => r.from_id === e.id || r.to_id === e.id
        ).length,
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
    }).catch(() => {
      // Backend not running — keep demo data
    });
  }, []);

  // UI state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<EntityType[]>(
    ['supplier', 'port', 'factory', 'material', 'customer']
  );
  const [showDeprecated, setShowDeprecated] = useState(false);

  // Modal state
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);

  const selectedEntity = useMemo(
    () => entities.find(e => e.id === selectedNodeId) || null,
    [selectedNodeId, entities]
  );

  const editingEntity = useMemo(
    () => (editingEntityId ? entities.find(e => e.id === editingEntityId) || null : null),
    [editingEntityId, entities]
  );

  // Apply filters
  const filteredEntities = useMemo(
    () => entities.filter(e => activeFilters.includes(e.type)),
    [entities, activeFilters]
  );

  const filteredRelationships = useMemo(() => {
    const entityIds = new Set(filteredEntities.map(e => e.id));
    let rels = relationships.filter(
      r => entityIds.has(r.sourceId) && entityIds.has(r.targetId)
    );
    if (showDeprecated) {
      rels = rels.filter(r => r.deprecated);
    }
    return rels;
  }, [filteredEntities, relationships, showDeprecated]);

  const handleToggleFilter = (type: EntityType) => {
    setActiveFilters(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  // === Node operations ===

  const handleAddNode = useCallback(() => {
    setModalMode('add');
    setEditingEntityId(null);
  }, []);

  const handleEditNode = useCallback((id: string) => {
    setModalMode('edit');
    setEditingEntityId(id);
  }, []);

  const handleSaveNode = useCallback((entity: Entity) => {
    if (modalMode === 'add') {
      setEntities(prev => [...prev, entity]);
    } else if (modalMode === 'edit') {
      setEntities(prev => prev.map(e => e.id === entity.id ? entity : e));
    }
    setModalMode(null);
    setEditingEntityId(null);
  }, [modalMode]);

  const handleDeleteNode = useCallback((id: string) => {
    setEntities(prev => prev.filter(e => e.id !== id));
    setRelationships(prev => prev.filter(r => r.sourceId !== id && r.targetId !== id));
    setSelectedNodeId(null);
  }, []);

  const handleUpdateNodePosition = useCallback((_id: string, _x: number, _y: number) => {
    // Position updates are handled in canvas state; this hook is for
    // persisting positions to a backend in the future
  }, []);

  return (
    <div className="full-bleed">
      {/* Floating toolbar */}
      <div className="graph-search-bar">
        <GraphSearch onSelectEntity={setSelectedNodeId} />
        <GraphFilters
          activeFilters={activeFilters}
          showDeprecated={showDeprecated}
          onToggleFilter={handleToggleFilter}
          onToggleDeprecated={() => setShowDeprecated(!showDeprecated)}
        />
        <button
          className="btn btn--primary"
          onClick={handleAddNode}
          style={{ whiteSpace: 'nowrap', fontSize: 12, padding: '6px 14px' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Node
        </button>
      </div>

      {/* Interactive canvas */}
      <GraphCanvas
        entities={filteredEntities}
        relationships={filteredRelationships}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        onEditNode={handleEditNode}
        onUpdateNodePosition={handleUpdateNodePosition}
      />

      {/* Inspector panel — slides in from right on node click */}
      {selectedEntity && (
        <InspectorPanel
          entity={selectedEntity}
          relationships={relationships}
          allEntities={entities}
          onClose={() => setSelectedNodeId(null)}
          onEdit={() => handleEditNode(selectedEntity.id)}
          onDelete={() => handleDeleteNode(selectedEntity.id)}
        />
      )}

      {/* Add/Edit modal */}
      {modalMode && (
        <NodeModal
          entity={modalMode === 'edit' ? editingEntity : null}
          onSave={handleSaveNode}
          onClose={() => { setModalMode(null); setEditingEntityId(null); }}
        />
      )}
    </div>
  );
}
