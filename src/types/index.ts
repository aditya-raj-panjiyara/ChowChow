/* ============================================================
   Types — Shared TypeScript interfaces
   ============================================================ */

/** Entity types in the supply chain knowledge graph */
export type EntityType = 'supplier' | 'port' | 'factory' | 'material' | 'customer' | 'transit';

/** Entity node in the knowledge graph */
export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  region?: string;
  metadata?: Record<string, string>;
  /** Number of direct connections */
  connectionCount: number;
  /** Whether this entity has correction history */
  hasCorrectionHistory?: boolean;
  status?: string;
}

/** Relationship between two entities */
export interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  /** Whether this relationship has been deprecated via corrections */
  deprecated?: boolean;
  weight?: number;
}

/** Alert severity levels */
export type AlertSeverity = 'critical' | 'elevated' | 'normal';

/** Active alert */
export interface Alert {
  id: string;
  severity: AlertSeverity;
  entityName: string;
  entityId: string;
  description: string;
  timestamp: string;
  /** Downstream entities affected */
  downstreamEntities?: string[];
  /** Drift Sentinel: ready-to-apply correction text */
  suggestedCorrection?: string;
}

/** Activity feed item */
export type ActivityType = 'upload' | 'query' | 'correction';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  description: string;
  timestamp: string;
}

/** Risk posture status */
export type RiskStatus = 'Stable' | 'Elevated' | 'Critical';

/** Ingestion source categories */
export interface SourceCategory {
  id: string;
  name: string;
  icon: string;
  active: boolean;
  locked: boolean;
  lockedReason?: string;
}

/** Ingestion file status */
export type FileStatus = 'queued' | 'parsing' | 'extracting' | 'cognify' | 'complete' | 'failed';

/** Ingestion file */
export interface FileItem {
  id: string;
  name: string;
  type: string; // pdf, csv, xlsx, eml
  size: string;
  status: FileStatus;
  /** Current processing stage description */
  stageText?: string;
  error?: string;
}

/** Query confidence level */
export type ConfidenceLevel = 'high' | 'partial' | 'low';

/** Reasoning path hop */
export interface ReasoningHop {
  entityId: string;
  entityName: string;
  entityType: EntityType;
}

/** Query message */
export interface QueryMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  /** AI-only fields */
  confidence?: ConfidenceLevel;
  reasoningPath?: ReasoningHop[];
  hopCount?: number;
  /** Session Q&A id — enables the feedback → improve() loop */
  qaId?: string;
}

/** Navigation tab definition */
export interface NavTab {
  id: string;
  label: string;
  path: string;
  icon: string;
  locked?: boolean;
  lockedBadge?: string;
}

/** LLM provider type */
export type LlmProvider = 'local' | 'openai' | 'gemini' | 'groq' | 'custom' | 'anthropic';

export interface LlmSettings {
  provider: LlmProvider;
  model: string;
  api_key: string;
  endpoint: string;
}

/** Settings state */
export interface AppSettings {
  llm: LlmSettings;
  storage_path: string;
}

/** Graph node position (for force simulation) */
export interface NodePosition {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Topology strip node (simplified for the strip) */
export interface TopologyNode {
  x: number; // normalized 0-1 position along strip
  disrupted: boolean;
}
