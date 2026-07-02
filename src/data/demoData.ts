/* ============================================================
   Demo Data — Sample supply chain dataset
   
   Provides realistic-looking data so the UI is never empty.
   Every entity, relationship, alert, and query here is
   synthetic and designed to showcase the full UI.
   ============================================================ */

import type {
  Entity,
  Relationship,
  Alert,
  ActivityItem,
  QueryMessage,
  FileItem,
  SourceCategory,
  NavTab,
  TopologyNode,
  RiskStatus,
} from '../types';

/* ── Entities ─────────────────────────────────────────── */

export const demoEntities: Entity[] = [
  { id: 'SUP-001', name: 'Shandong Metals Co.', type: 'supplier', region: 'CN-East', connectionCount: 6, hasCorrectionHistory: true },
  { id: 'SUP-002', name: 'Nippon Chemical Supply', type: 'supplier', region: 'JP-Kanto', connectionCount: 4 },
  { id: 'SUP-003', name: 'Vale Mineração S.A.', type: 'supplier', region: 'BR-Southeast', connectionCount: 5 },
  { id: 'PRT-001', name: 'Port of Santos', type: 'port', region: 'BR-SP', connectionCount: 7 },
  { id: 'PRT-002', name: 'Port of Rotterdam', type: 'port', region: 'NL-ZH', connectionCount: 8 },
  { id: 'PRT-003', name: 'Port of Shanghai', type: 'port', region: 'CN-SH', connectionCount: 9 },
  { id: 'FAC-001', name: 'Wolfsburg Assembly Plant', type: 'factory', region: 'DE-NI', connectionCount: 5 },
  { id: 'FAC-002', name: 'Guangzhou Electronics Hub', type: 'factory', region: 'CN-GD', connectionCount: 4 },
  { id: 'FAC-003', name: 'Tennessee Components LLC', type: 'factory', region: 'US-TN', connectionCount: 3 },
  { id: 'MAT-001', name: 'Lithium Carbonate (Li₂CO₃)', type: 'material', region: 'Global', connectionCount: 5 },
  { id: 'MAT-002', name: 'Rare Earth Oxides', type: 'material', region: 'CN', connectionCount: 4 },
  { id: 'MAT-003', name: 'High-Grade Steel Coil', type: 'material', region: 'Global', connectionCount: 6 },
  { id: 'CUS-001', name: 'Stellantis NV', type: 'customer', region: 'EU', connectionCount: 3 },
  { id: 'CUS-002', name: 'Tesla Inc.', type: 'customer', region: 'US', connectionCount: 4 },
  { id: 'CUS-003', name: 'Samsung SDI', type: 'customer', region: 'KR', connectionCount: 3 },
];

/* ── Relationships ────────────────────────────────────── */

export const demoRelationships: Relationship[] = [
  { id: 'R-001', sourceId: 'SUP-001', targetId: 'MAT-003', label: 'supplies' },
  { id: 'R-002', sourceId: 'SUP-001', targetId: 'PRT-003', label: 'ships_via' },
  { id: 'R-003', sourceId: 'SUP-002', targetId: 'MAT-002', label: 'supplies' },
  { id: 'R-004', sourceId: 'SUP-003', targetId: 'MAT-001', label: 'supplies' },
  { id: 'R-005', sourceId: 'SUP-003', targetId: 'PRT-001', label: 'ships_via' },
  { id: 'R-006', sourceId: 'PRT-001', targetId: 'PRT-002', label: 'route_to' },
  { id: 'R-007', sourceId: 'PRT-002', targetId: 'FAC-001', label: 'delivers_to' },
  { id: 'R-008', sourceId: 'PRT-003', targetId: 'FAC-002', label: 'delivers_to' },
  { id: 'R-009', sourceId: 'MAT-001', targetId: 'FAC-003', label: 'used_in' },
  { id: 'R-010', sourceId: 'MAT-002', targetId: 'FAC-002', label: 'used_in' },
  { id: 'R-011', sourceId: 'MAT-003', targetId: 'FAC-001', label: 'used_in' },
  { id: 'R-012', sourceId: 'FAC-001', targetId: 'CUS-001', label: 'fulfills' },
  { id: 'R-013', sourceId: 'FAC-002', targetId: 'CUS-003', label: 'fulfills' },
  { id: 'R-014', sourceId: 'FAC-003', targetId: 'CUS-002', label: 'fulfills' },
  { id: 'R-015', sourceId: 'MAT-003', targetId: 'FAC-003', label: 'used_in' },
  { id: 'R-016', sourceId: 'PRT-003', targetId: 'PRT-002', label: 'route_to', deprecated: true },
  { id: 'R-017', sourceId: 'SUP-001', targetId: 'FAC-002', label: 'supplies', deprecated: true },
  { id: 'R-018', sourceId: 'MAT-001', targetId: 'FAC-002', label: 'used_in' },
];

/* ── Alerts ───────────────────────────────────────────── */

export const demoAlerts: Alert[] = [
  {
    id: 'ALT-001',
    severity: 'critical',
    entityName: 'Port of Santos',
    entityId: 'PRT-001',
    description: 'Port operations suspended due to labor strike — estimated 14-day shutdown',
    timestamp: '2025-06-28T14:23:00Z',
    downstreamEntities: ['Port of Rotterdam', 'Wolfsburg Assembly Plant', 'Stellantis NV'],
  },
  {
    id: 'ALT-002',
    severity: 'elevated',
    entityName: 'Shandong Metals Co.',
    entityId: 'SUP-001',
    description: 'Delivery delays reported — steel coil shipments 8 days behind schedule',
    timestamp: '2025-06-29T09:45:00Z',
    downstreamEntities: ['Wolfsburg Assembly Plant', 'Tennessee Components LLC'],
  },
  {
    id: 'ALT-003',
    severity: 'elevated',
    entityName: 'Lithium Carbonate (Li₂CO₃)',
    entityId: 'MAT-001',
    description: 'Spot price surged 22% week-over-week — contract renegotiation risk',
    timestamp: '2025-06-30T06:12:00Z',
    downstreamEntities: ['Tesla Inc.', 'Samsung SDI'],
  },
  {
    id: 'ALT-004',
    severity: 'normal',
    entityName: 'Port of Rotterdam',
    entityId: 'PRT-002',
    description: 'Scheduled maintenance window — no impact on throughput expected',
    timestamp: '2025-06-30T01:00:00Z',
  },
];

/* ── Activity Feed ────────────────────────────────────── */

export const demoActivity: ActivityItem[] = [
  { id: 'ACT-001', type: 'upload', description: 'Ingested supplier_contracts_q2.pdf', timestamp: '2025-06-30T06:45:00Z' },
  { id: 'ACT-002', type: 'query', description: 'Query: "What happens if Santos port shuts down?"', timestamp: '2025-06-30T06:32:00Z' },
  { id: 'ACT-003', type: 'correction', description: 'Corrected: Shandong → Guangzhou direct supply link deprecated', timestamp: '2025-06-29T22:15:00Z' },
  { id: 'ACT-004', type: 'upload', description: 'Ingested logistics_email_chain_jun28.eml', timestamp: '2025-06-29T18:30:00Z' },
  { id: 'ACT-005', type: 'query', description: 'Query: "Lithium exposure across all customers"', timestamp: '2025-06-29T16:00:00Z' },
  { id: 'ACT-006', type: 'upload', description: 'Ingested erp_inventory_snapshot.csv', timestamp: '2025-06-29T14:20:00Z' },
  { id: 'ACT-007', type: 'correction', description: 'Confirmed: Shanghai → Rotterdam route via Suez', timestamp: '2025-06-29T11:45:00Z' },
  { id: 'ACT-008', type: 'upload', description: 'Ingested port_schedules_jul.xlsx', timestamp: '2025-06-29T09:00:00Z' },
];

/* ── Sample Queries ───────────────────────────────────── */

export const demoQueries: QueryMessage[] = [
  {
    id: 'Q-001',
    role: 'user',
    content: 'If the port in Santos shuts down for two weeks, which customer orders are at risk?',
  },
  {
    id: 'Q-002',
    role: 'ai',
    content: 'A 14-day shutdown at Port of Santos would disrupt the primary shipping route for Vale Mineração\'s lithium carbonate supply. This creates a cascading delay through Port of Rotterdam to Wolfsburg Assembly Plant, directly impacting Stellantis NV\'s Q3 vehicle production orders.\n\nTennessee Components LLC also receives lithium carbonate through an alternate route, but their buffer stock covers only 9 days at current consumption rates. Tesla Inc.\'s battery module orders would enter risk territory by day 10.',
    confidence: 'high',
    hopCount: 3,
    reasoningPath: [
      { entityId: 'PRT-001', entityName: 'Port of Santos', entityType: 'port' },
      { entityId: 'MAT-001', entityName: 'Lithium Carbonate', entityType: 'material' },
      { entityId: 'FAC-001', entityName: 'Wolfsburg Assembly', entityType: 'factory' },
      { entityId: 'CUS-001', entityName: 'Stellantis NV', entityType: 'customer' },
    ],
  },
  {
    id: 'Q-003',
    role: 'user',
    content: 'What is our total exposure to rare earth supply from China?',
  },
  {
    id: 'Q-004',
    role: 'ai',
    content: 'Your supply chain has a single-source dependency on Nippon Chemical Supply for rare earth oxides, which are sourced from Chinese extraction operations. These materials flow through Port of Shanghai to Guangzhou Electronics Hub, ultimately serving Samsung SDI\'s component orders.\n\nThere is no secondary supplier in the current graph for rare earth materials. This represents a concentration risk — any disruption to Chinese rare earth exports would have zero-buffer impact on Samsung SDI fulfillment.',
    confidence: 'partial',
    hopCount: 4,
    reasoningPath: [
      { entityId: 'SUP-002', entityName: 'Nippon Chemical', entityType: 'supplier' },
      { entityId: 'MAT-002', entityName: 'Rare Earth Oxides', entityType: 'material' },
      { entityId: 'FAC-002', entityName: 'Guangzhou Hub', entityType: 'factory' },
      { entityId: 'CUS-003', entityName: 'Samsung SDI', entityType: 'customer' },
    ],
  },
];

/* ── Ingestion Sources ────────────────────────────────── */

export const demoSources: SourceCategory[] = [
  { id: 'src-erp', name: 'ERP Files', icon: 'database', active: true, locked: false },
  { id: 'src-email', name: 'Email Chains', icon: 'mail', active: true, locked: false },
  { id: 'src-pdf', name: 'PDFs', icon: 'file-text', active: true, locked: false },
  { id: 'src-trade', name: 'Trade Feeds', icon: 'radio', active: false, locked: true, lockedReason: 'Coming in v2' },
];

/* ── Ingestion File List ──────────────────────────────── */

export const demoFiles: FileItem[] = [
  { id: 'F-001', name: 'supplier_contracts_q2.pdf', type: 'pdf', size: '2.4 MB', status: 'complete', stageText: 'Done' },
  { id: 'F-002', name: 'erp_inventory_snapshot.csv', type: 'csv', size: '890 KB', status: 'complete', stageText: 'Done' },
  { id: 'F-003', name: 'logistics_email_chain_jun28.eml', type: 'eml', size: '156 KB', status: 'complete', stageText: 'Done' },
  { id: 'F-004', name: 'port_schedules_jul.xlsx', type: 'xlsx', size: '1.1 MB', status: 'extracting', stageText: 'Extracting entities (ports, schedules...)' },
  { id: 'F-005', name: 'customs_declaration_br.pdf', type: 'pdf', size: '3.2 MB', status: 'parsing', stageText: 'Parsing document structure' },
];

/* ── Navigation Tabs ──────────────────────────────────── */

export const navTabs: NavTab[] = [
  { id: 'command-center', label: 'Command Center', path: '/', icon: 'shield' },
  { id: 'ingestion', label: 'Ingestion', path: '/ingestion', icon: 'upload' },
  { id: 'graph-explorer', label: 'Graph Explorer', path: '/graph', icon: 'share-2' },
  { id: 'query-ask', label: 'Query / Ask', path: '/query', icon: 'message-circle' },
  { id: 'blast-radius', label: 'Blast Radius', path: '/blast-radius', icon: 'zap' },
  { id: 'corrections-log', label: 'Corrections Log', path: '/corrections', icon: 'check-circle' },
  { id: 'settings', label: 'Settings', path: '/settings', icon: 'settings' },
];

/* ── Topology Strip Data ──────────────────────────────── */

export const demoTopologyNodes: TopologyNode[] = [
  { x: 0.08, disrupted: false },
  { x: 0.15, disrupted: false },
  { x: 0.22, disrupted: true },  // Santos — disrupted
  { x: 0.31, disrupted: false },
  { x: 0.38, disrupted: false },
  { x: 0.45, disrupted: false },
  { x: 0.52, disrupted: false },
  { x: 0.60, disrupted: true },  // Shandong — delivery delays
  { x: 0.68, disrupted: false },
  { x: 0.75, disrupted: false },
  { x: 0.82, disrupted: false },
  { x: 0.88, disrupted: false },
  { x: 0.93, disrupted: false },
];

/* ── Risk Status ──────────────────────────────────────── */

export const currentRiskStatus: RiskStatus = 'Elevated';

/* ── Ingestion Stats ──────────────────────────────────── */

export const ingestionStats = {
  entityCount: 1204,
  relationshipCount: 3891,
};
