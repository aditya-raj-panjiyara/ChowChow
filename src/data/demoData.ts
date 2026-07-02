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
  { id: 'SUP-001', name: 'Leslie Chow Enterprises', type: 'supplier', region: 'TH-Bangkok', connectionCount: 6, hasCorrectionHistory: true },
  { id: 'SUP-002', name: 'Black Doug Distribution', type: 'supplier', region: 'US-NV', connectionCount: 4 },
  { id: 'SUP-003', name: 'Marshall Freight Lines', type: 'supplier', region: 'MX-TJ', connectionCount: 3 },
  { id: 'PRT-001', name: 'Port of Long Beach', type: 'port', region: 'US-CA', connectionCount: 7 },
  { id: 'PRT-002', name: 'Port of Bangkok', type: 'port', region: 'TH-BKK', connectionCount: 5 },
  { id: 'PRT-003', name: 'Tijuana Depot', type: 'port', region: 'MX-TJ', connectionCount: 3 },
  { id: 'FAC-001', name: 'Golden Tiger Warehouse', type: 'factory', region: 'TH-Bangkok', connectionCount: 5 },
  { id: 'FAC-002', name: 'Caesars Palace Vault', type: 'factory', region: 'US-NV', connectionCount: 4 },
  { id: 'FAC-003', name: 'Las Vegas Strip Hub', type: 'factory', region: 'US-NV', connectionCount: 3 },
  { id: 'MAT-001', name: 'Lucky Lotus Powder', type: 'material', region: 'TH', connectionCount: 5 },
  { id: 'MAT-002', name: 'Counterfeit Casino Chips', type: 'material', region: 'TH', connectionCount: 3 },
  { id: 'MAT-003', name: 'Stolen Rolex Crates', type: 'material', region: 'MX', connectionCount: 3 },
  { id: 'CUS-001', name: 'The Wolfpack', type: 'customer', region: 'US-NV', connectionCount: 4 },
  { id: 'CUS-002', name: 'Kingsley Syndicate', type: 'customer', region: 'US-NV', connectionCount: 3 },
  { id: 'CUS-003', name: 'Doug Billings', type: 'customer', region: 'US-NV', connectionCount: 2 },
];

/* ── Relationships ────────────────────────────────────── */

export const demoRelationships: Relationship[] = [
  { id: 'R-001', sourceId: 'SUP-001', targetId: 'MAT-001', label: 'supplies' },
  { id: 'R-002', sourceId: 'SUP-001', targetId: 'MAT-002', label: 'supplies' },
  { id: 'R-003', sourceId: 'SUP-001', targetId: 'FAC-001', label: 'stocks' },
  { id: 'R-004', sourceId: 'FAC-001', targetId: 'PRT-002', label: 'ships_via' },
  { id: 'R-005', sourceId: 'PRT-002', targetId: 'PRT-001', label: 'route_to' },
  { id: 'R-006', sourceId: 'PRT-001', targetId: 'SUP-002', label: 'delivers_to' },
  { id: 'R-007', sourceId: 'SUP-002', targetId: 'FAC-002', label: 'distributes_to' },
  { id: 'R-008', sourceId: 'SUP-002', targetId: 'CUS-002', label: 'distributes_to' },
  { id: 'R-009', sourceId: 'FAC-002', targetId: 'CUS-001', label: 'fulfills' },
  { id: 'R-010', sourceId: 'SUP-003', targetId: 'PRT-003', label: 'operates' },
  { id: 'R-011', sourceId: 'PRT-003', targetId: 'FAC-003', label: 'route_to' },
  { id: 'R-012', sourceId: 'MAT-003', targetId: 'PRT-003', label: 'ships_via' },
  { id: 'R-013', sourceId: 'MAT-002', targetId: 'FAC-002', label: 'stored_in' },
  { id: 'R-014', sourceId: 'FAC-003', targetId: 'CUS-002', label: 'fulfills' },
  { id: 'R-015', sourceId: 'MAT-001', targetId: 'CUS-002', label: 'ordered_by' },
  { id: 'R-016', sourceId: 'PRT-002', targetId: 'PRT-003', label: 'route_to', deprecated: true },
  { id: 'R-017', sourceId: 'SUP-001', targetId: 'CUS-001', label: 'supplies', deprecated: true },
  { id: 'R-018', sourceId: 'FAC-002', targetId: 'CUS-003', label: 'fulfills' },
];

/* ── Alerts ───────────────────────────────────────────── */

export const demoAlerts: Alert[] = [
  {
    id: 'ALT-001',
    severity: 'critical',
    entityName: 'Port of Long Beach',
    entityId: 'PRT-001',
    description: 'Customs crackdown — container from Golden Tiger Warehouse flagged, estimated 14-day shutdown',
    timestamp: '2026-06-30T14:23:00Z',
    downstreamEntities: ['Black Doug Distribution', 'Caesars Palace Vault', 'Kingsley Syndicate'],
  },
  {
    id: 'ALT-002',
    severity: 'elevated',
    entityName: 'Port of Bangkok',
    entityId: 'PRT-002',
    description: 'Outbound shipments running two weeks behind — Golden Tiger Warehouse backlog growing',
    timestamp: '2026-07-01T09:45:00Z',
    downstreamEntities: ['Port of Long Beach', 'Black Doug Distribution'],
  },
  {
    id: 'ALT-003',
    severity: 'elevated',
    entityName: 'Lucky Lotus Powder',
    entityId: 'MAT-001',
    description: 'Kingsley Syndicate holds zero buffer stock — Friday deadline at risk',
    timestamp: '2026-07-02T06:12:00Z',
    downstreamEntities: ['Kingsley Syndicate', 'The Wolfpack'],
  },
  {
    id: 'ALT-004',
    severity: 'normal',
    entityName: 'Tijuana Depot',
    entityId: 'PRT-003',
    description: 'Marshall Freight Lines alternate route operating on schedule',
    timestamp: '2026-07-02T01:00:00Z',
  },
];

/* ── Activity Feed ────────────────────────────────────── */

export const demoActivity: ActivityItem[] = [
  { id: 'ACT-001', type: 'upload', description: 'Ingested vegas_intel_report.txt', timestamp: '2026-07-02T06:45:00Z' },
  { id: 'ACT-002', type: 'query', description: 'Query: "Who supplies Lucky Lotus Powder?"', timestamp: '2026-07-02T06:32:00Z' },
  { id: 'ACT-003', type: 'correction', description: 'Corrected: Chow → Wolfpack direct supply link deprecated', timestamp: '2026-07-01T22:15:00Z' },
  { id: 'ACT-004', type: 'upload', description: 'Ingested wolfpack_email_chain.txt', timestamp: '2026-07-01T18:30:00Z' },
  { id: 'ACT-005', type: 'query', description: 'Query: "Exposure if Long Beach customs hold continues"', timestamp: '2026-07-01T16:00:00Z' },
  { id: 'ACT-006', type: 'upload', description: 'Ingested chow_shipments_erp.csv', timestamp: '2026-07-01T14:20:00Z' },
  { id: 'ACT-007', type: 'correction', description: 'Confirmed: Bangkok → Long Beach as sole powder route', timestamp: '2026-07-01T11:45:00Z' },
  { id: 'ACT-008', type: 'upload', description: 'Ingested tijuana_manifest_jul.xlsx', timestamp: '2026-07-01T09:00:00Z' },
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
  { x: 0.22, disrupted: true },  // Long Beach — customs crackdown
  { x: 0.31, disrupted: false },
  { x: 0.38, disrupted: false },
  { x: 0.45, disrupted: false },
  { x: 0.52, disrupted: false },
  { x: 0.60, disrupted: true },  // Port of Bangkok — backlog
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
