import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { AppSettings } from '../types';

// ─── Backend Types ────────────────────────────────────────────────────────────

export interface MemoryEntity {
  id: string;
  entity_type: string;
  name: string;
  attributes: Record<string, unknown>;
}

export interface MemoryRelationship {
  from_id: string;
  to_id: string;
  relationship_type: string;
  weight: number;
  active: boolean;
}

export interface BackendQueryResult {
  answer: string;
  reasoning_path: MemoryEntity[];
  confidence: 'High' | 'Partial' | 'Low';
}

export interface GraphSnapshot {
  entities: MemoryEntity[];
  relationships: MemoryRelationship[];
}

export interface IngestionJob {
  id: string;
  file_path: string;
  source_type: string;
  status: string;
  entities_extracted: number | null;
  relationships_extracted: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface CorrectionEntry {
  id: string;
  raw_text: string;
  author: string;
  status: string;
  audit_node_id: string | null;
  created_at: string;
}

export interface CorrectionResult {
  edges_created: number;
  edges_deprecated: number;
  edges_restored: number;
  audit_node_id: string;
}

export interface BlastAffectedEntity {
  id: string;
  name: string;
  entity_type: string;
  hop: number;
  impact_score: number;
  severity: 'critical' | 'elevated' | 'watch';
  path_ids: string[];
  path_names: string[];
  estimated_exposure_usd: number;
  buffer_days: number;
}

export interface MitigationStep {
  priority: number;
  action: string;
  target_entity_id: string;
  target_entity_name: string;
}

export interface BlastRadiusResult {
  origin_id: string;
  origin_name: string;
  origin_type: string;
  duration_days: number;
  affected: BlastAffectedEntity[];
  total_exposure_usd: number;
  max_hop: number;
  mitigations: MitigationStep[];
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export async function ingestFile(path: string, sourceType: string): Promise<IngestionJob> {
  return invoke('ingest_file', { path, sourceType });
}

export async function getIngestionStatus(): Promise<IngestionJob[]> {
  return invoke('get_ingestion_status');
}

export async function askQuestion(question: string): Promise<BackendQueryResult> {
  return invoke('ask_question', { question });
}

export async function getGraphSnapshot(): Promise<GraphSnapshot> {
  return invoke('get_graph_snapshot');
}

export async function submitCorrection(rawText: string, author: string, alertId?: string): Promise<CorrectionEntry> {
  return invoke('submit_correction', { rawText, author, alertId: alertId ?? null });
}

export async function confirmCorrection(correctionId: string): Promise<CorrectionResult> {
  return invoke('confirm_correction', { correctionId });
}

export async function rejectCorrection(correctionId: string): Promise<void> {
  return invoke('reject_correction', { correctionId });
}

export async function listCorrections(): Promise<CorrectionEntry[]> {
  return invoke('list_corrections');
}

export async function simulateBlastRadius(
  entityId: string,
  durationDays: number,
): Promise<BlastRadiusResult> {
  return invoke('simulate_blast_radius', { entityId, durationDays });
}

export interface BackendAlert {
  id: string;
  severity: 'critical' | 'elevated' | 'stable';
  entity_id: string | null;
  description: string;
  suggested_correction: string | null;
  status: 'active' | 'resolved' | 'dismissed';
  resolved_at: string | null;
  created_at: string;
}

export async function listAlerts(): Promise<BackendAlert[]> {
  return invoke('list_alerts');
}

export async function resolveAlert(alertId: string, resolution: 'resolved' | 'dismissed'): Promise<void> {
  return invoke('resolve_alert', { alertId, resolution });
}

export async function getSettings(): Promise<AppSettings> {
  return invoke('get_settings');
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke('save_settings', { settings });
}

export async function getSystemInfo(): Promise<{ arch: string; os: string }> {
  return invoke('get_system_info');
}

export interface OllamaModelDetails {
  parent_model?: string;
  format?: string;
  family?: string;
  families?: string[];
  parameter_size?: string;
  quantization_level?: string;
}

export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: OllamaModelDetails;
  capabilities?: string[];
}

export async function getOllamaModels(endpoint: string): Promise<OllamaModel[]> {
  return invoke('get_ollama_models', { endpoint });
}


export async function addCustomNode(id: string, name: string, entityType: string): Promise<void> {
  return invoke('add_custom_node', { id, name, entityType });
}

export async function deleteCustomNode(id: string): Promise<void> {
  return invoke('delete_custom_node', { id });
}

export async function addCustomRelationship(fromId: string, toId: string, relationshipType: string): Promise<void> {
  return invoke('add_custom_relationship', { fromId, toId, relationshipType });
}

export async function restoreDeletedGraph(): Promise<number> {
  return invoke('restore_deleted_graph');
}

export async function deleteCustomRelationship(fromId: string, toId: string, relationshipType: string): Promise<void> {
  return invoke('delete_custom_relationship', { fromId, toId, relationshipType });
}

export interface GoogleAuthStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
}

export async function googleAuthStatus(): Promise<GoogleAuthStatus> {
  return invoke('google_auth_status');
}

export async function googleConnect(): Promise<GoogleAuthStatus> {
  return invoke('google_connect');
}

export async function googleDisconnect(): Promise<void> {
  return invoke('google_disconnect');
}

export interface GoogleSyncParams {
  query: string;
  sync_gmail: boolean;
  sync_drive: boolean;
}

export interface GoogleSyncResult {
  success: boolean;
  message: string;
  files_synced: number;
  entities_extracted: number;
}

export async function syncGoogleWorkspace(params: GoogleSyncParams): Promise<GoogleSyncResult> {
  return invoke('sync_google_workspace', { params });
}

// ─── File Dialog ──────────────────────────────────────────────────────────────

export async function pickFiles(): Promise<string[]> {
  const result = await openDialog({
    multiple: true,
    filters: [
      { name: 'Supported files', extensions: ['pdf', 'csv', 'xlsx', 'eml', 'txt'] },
    ],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function sourceTypeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'pdf': return 'pdf';
    case 'csv':
    case 'xlsx':
    case 'xls': return 'erp';
    case 'eml':
    case 'msg': return 'email';
    default: return 'pdf';
  }
}
